import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { loadEifCriteriaConfig } from './eif-criteria.config.js';
import { percentToEifRag } from './eif-rag.util.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { EifScoreSnapshot } from './entities/eif-score-snapshot.entity.js';

import type {
  EifScoreTrendResponseDto,
  EifTrendPointDto,
} from './dto/eif-score-trend-response.dto.js';

/** The window F2.1.1 asks for. */
const TREND_WINDOW_MONTHS = 12;

/** Fewest captured days that can show movement rather than a single reading. */
const MIN_TREND_POINTS = 2;

/** `YYYY-MM-DD` in UTC — the snapshot is keyed by calendar day. */
function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractMonths(from: Date, months: number): Date {
  const result = new Date(from);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

/**
 * F2.1.1 — captures today's EIF scores so a trend can be drawn later, and
 * reads back the last twelve months.
 *
 * **Everything here runs under the RLS bootstrap flag.** The capture runs from
 * a nightly cron, which has no signed-in user and no active organisation, so
 * `app_current_org()` is unset. Every table the calculator reads — enrolments,
 * OTJ logs, reviews, portfolio evidence, programme documents — is tenant
 * scoped, so without the flag the calculator would compute a score from zero
 * rows and cheerfully record 0% for every provider, every night, forever.
 *
 * That is not hypothetical. The commitment chase cron had exactly this shape
 * at the end of Portal 1: it read `users` with no tenant context, found
 * nobody, sent no email, and reported success. This service is written with
 * the flag from the first commit rather than discovering it in production.
 */
@Injectable()
export class EifScoreSnapshotService {
  private readonly logger = new Logger(EifScoreSnapshotService.name);

  constructor(
    @InjectRepository(EifScoreSnapshot)
    private readonly snapshotRepo: Repository<EifScoreSnapshot>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    private readonly calculator: EifScoreCalculatorService,
  ) {}

  /** Captures every provider organisation. Returns how many were recorded. */
  async captureAll(now: Date = new Date()): Promise<number> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisations = await this.organisationRepo.find({
        where: { portalType: PortalType.PROVIDER, isDeleted: false },
        select: ['id'],
      });

      let captured = 0;
      for (const organisation of organisations) {
        // One organisation failing must not stop the sweep — a provider with
        // malformed data should not cost every other provider a day of trend.
        try {
          await this.captureForOrganisation(organisation.id, now);
          captured += 1;
        } catch (error) {
          this.logger.warn(
            `EIF snapshot failed for org ${organisation.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return captured;
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  /**
   * Idempotent for a given day. Re-running replaces the day's row rather than
   * adding a second point, which matters because the cron can be retried and
   * because an operator may run it by hand during an incident.
   */
  async captureForOrganisation(
    organisationId: string,
    now: Date = new Date(),
  ): Promise<EifScoreSnapshot> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const computed = await this.calculator.calculate(organisationId);
      const capturedOn = toDay(now);

      const existing = await this.snapshotRepo.findOne({
        where: { organisationId, capturedOn, isDeleted: false },
      });

      const values = {
        organisationId,
        capturedOn,
        overallPercent: computed.overallPercent,
        overallRag: percentToEifRag(computed.overallPercent),
        criteria: computed.criteria.map((c) => ({
          slug: c.slug,
          label: c.label,
          percent: c.percent,
          rag: c.rag,
        })),
      };

      if (existing) {
        Object.assign(existing, values);
        return await this.snapshotRepo.save(existing);
      }
      return await this.snapshotRepo.save(this.snapshotRepo.create(values));
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  /**
   * F2.1.1 — the twelve-month trend, one series per criterion.
   *
   * Built from the criteria catalogue rather than from whatever the snapshots
   * happen to contain, so a criterion added part-way through the window still
   * appears (with a shorter series) instead of vanishing, and the hub's chart
   * order matches its score order.
   */
  async getTrend(
    organisationId: string,
    now: Date = new Date(),
  ): Promise<EifScoreTrendResponseDto> {
    const snapshots = await this.listTrend(organisationId, now);
    const catalogue = loadEifCriteriaConfig().criteria;

    const criteria = catalogue.map((definition) => ({
      slug: definition.slug,
      label: definition.label,
      points: snapshots
        .map((snapshot) => {
          const match = snapshot.criteria.find(
            (c) => c.slug === definition.slug,
          );
          if (!match) return null;
          return {
            capturedOn: snapshot.capturedOn,
            percent: match.percent,
            rag: match.rag,
          };
        })
        .filter((point): point is EifTrendPointDto => point !== null),
    }));

    return {
      criteria,
      overall: snapshots.map((snapshot) => ({
        capturedOn: snapshot.capturedOn,
        percent: snapshot.overallPercent,
        rag: snapshot.overallRag,
      })),
      pointCount: snapshots.length,
      /**
       * Two points is the minimum that can show movement, which is what the
       * criterion asks for. One reading is a fact, not a trend, and drawing
       * it as a line reads as "flat" rather than "we have only just started
       * recording".
       */
      hasTrendData: snapshots.length >= MIN_TREND_POINTS,
      earliestCapturedOn: snapshots[0]?.capturedOn ?? null,
      windowMonths: TREND_WINDOW_MONTHS,
    };
  }

  /**
   * The last twelve months of snapshots, oldest first.
   *
   * Returns whatever exists — which for a newly onboarded provider is very
   * little, and on the day this ships is nothing at all. The caller is
   * expected to say so rather than draw a line through one point; the same
   * "where historical data exists" honesty F1.4.1 AC3 required.
   */
  async listTrend(
    organisationId: string,
    now: Date = new Date(),
  ): Promise<EifScoreSnapshot[]> {
    return this.snapshotRepo.find({
      where: {
        organisationId,
        isDeleted: false,
        capturedOn: Between(
          toDay(subtractMonths(now, TREND_WINDOW_MONTHS)),
          toDay(now),
        ),
      },
      order: { capturedOn: 'ASC' },
    });
  }
}
