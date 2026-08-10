import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';
import {
  computeOtjPaceSnapshot,
  computeOtjPercentOfTarget,
  type OtjMinutesBreakdown,
  type OtjPaceSnapshot,
} from './otj-pace-calculator.js';

/**
 * The one place OTJ minutes are counted and OTJ pace is evaluated.
 *
 * ── WHY THIS EXISTS (P0-A) ───────────────────────────────────────────────────
 *
 * Before this, the same two questions were answered in two files:
 *
 *   "how many approved minutes does this enrolment have?"
 *     · `OtjPaceService.sumApprovedMinutes`            (org-scoped)
 *     · `OtjProgressMetricsService.approvedMinutesForEnrolment`  (not org-scoped)
 *
 *   "what percentage of target is that?"
 *     · `computeOtjPaceSnapshot`'s `totalTargetMinutes`
 *     · `OtjProgressMetricsService.computePercentForEnrolment`
 *
 * Two implementations of one funding-relevant number is exactly the duplication
 * that produced the "every provider at 0% average OTJ" defect recorded in
 * `otj-progress-metrics.service.ts` — one copy filtered by an organisation the
 * rows were never stamped with, matched nothing, and reported a confident zero.
 * Both pairs are now consolidated here and the duplicates deleted.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 *
 * Deliberately scoped by `enrolmentId` and not by organisation.
 * `otj_log_entries.organisationId` is stamped with whoever logged the hours —
 * the apprentice, under the provider's org — so an employer filtering on their
 * own organisation id matches nothing. The enrolment id is the real key: an
 * entry belongs to exactly one enrolment, callers have already resolved which
 * enrolments they may see (see `LearnerScopeService` for the learner case), and
 * row-level security remains the backstop underneath.
 */
@Injectable()
export class OtjSummaryService {
  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
  ) {}

  /**
   * All four minute figures in one query.
   *
   * One pass with conditional sums rather than four `SUM` queries: this is on
   * the apprentice dashboard's critical path, and four round trips for four
   * numbers off the same rows is three too many.
   */
  async minutesForEnrolment(
    enrolmentId: string,
  ): Promise<OtjMinutesBreakdown> {
    const row = await this.otjRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.minutes), 0)', 'logged')
      .addSelect(
        `COALESCE(SUM(CASE WHEN entry.status = :submitted THEN entry.minutes ELSE 0 END), 0)`,
        'pending',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN entry.status = :approved THEN entry.minutes ELSE 0 END), 0)`,
        'approved',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN entry.status = :rejected THEN entry.minutes ELSE 0 END), 0)`,
        'rejected',
      )
      .where('entry.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('entry.isDeleted = false')
      .setParameters({
        submitted: OtjLogStatus.SUBMITTED,
        approved: OtjLogStatus.APPROVED,
        rejected: OtjLogStatus.REJECTED,
      })
      .getRawOne<{
        logged: string;
        pending: string;
        approved: string;
        rejected: string;
      }>();

    return {
      loggedMinutes: Number(row?.logged ?? 0),
      pendingMinutes: Number(row?.pending ?? 0),
      approvedMinutes: Number(row?.approved ?? 0),
      rejectedMinutes: Number(row?.rejected ?? 0),
    };
  }

  /** Approved minutes only. The figure D2 makes authoritative. */
  async approvedMinutesForEnrolment(enrolmentId: string): Promise<number> {
    const { approvedMinutes } = await this.minutesForEnrolment(enrolmentId);
    return approvedMinutes;
  }

  /** Approved minutes per enrolment, for callers evaluating many at once. */
  async approvedMinutesByEnrolment(
    enrolmentIds: string[],
  ): Promise<Map<string, number>> {
    if (enrolmentIds.length === 0) {
      return new Map();
    }

    const rows = await this.otjRepo
      .createQueryBuilder('entry')
      .select('entry.enrolmentId', 'enrolmentId')
      .addSelect('COALESCE(SUM(entry.minutes), 0)', 'approvedMinutes')
      .where('entry.enrolmentId IN (:...enrolmentIds)', { enrolmentIds })
      .andWhere('entry.status = :status', { status: OtjLogStatus.APPROVED })
      .andWhere('entry.isDeleted = false')
      .groupBy('entry.enrolmentId')
      .getRawMany<{ enrolmentId: string; approvedMinutes: string }>();

    return new Map(
      rows.map((row) => [row.enrolmentId, Number(row.approvedMinutes)]),
    );
  }

  /**
   * Percentage of the programme's OTJ target that is approved.
   *
   * `null` when the programme has no planned duration — unknown, not zero. That
   * distinction has mattered repeatedly here: a `0` renders as "you have logged
   * nothing", which is a different and wrong statement.
   */
  async percentForEnrolment(
    enrolment: Pick<Enrolment, 'id' | 'plannedDurationMonths'>,
  ): Promise<number | null> {
    const approvedMinutes = await this.approvedMinutesForEnrolment(
      enrolment.id,
    );
    return computeOtjPercentOfTarget(
      enrolment.plannedDurationMonths,
      approvedMinutes,
    );
  }

  /**
   * The full pace picture for one enrolment: the four minute figures, the
   * percentage of target, and the evaluated risk state.
   *
   * THRESHOLDS EVALUATE ON APPROVED MINUTES ONLY, per D2. `pendingMinutes` is
   * returned alongside the evaluated state rather than folded into it, so a
   * consumer can branch its messaging — F3.1.4 needs to distinguish "behind on
   * training" from "waiting on the provider", and those call for opposite
   * actions from the learner.
   */
  async paceForEnrolment(
    enrolment: Pick<
      Enrolment,
      | 'id'
      | 'plannedDurationMonths'
      | 'plannedStartDate'
      | 'plannedEndDate'
      | 'activatedAt'
      | 'epaDate'
    >,
    options: { asOf?: Date } = {},
  ): Promise<
    OtjPaceSnapshot & OtjMinutesBreakdown & { otjPercent: number | null }
  > {
    const minutes = await this.minutesForEnrolment(enrolment.id);

    const snapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: enrolment.plannedDurationMonths,
      plannedStartDate: enrolment.plannedStartDate,
      plannedEndDate: enrolment.plannedEndDate,
      activatedAt: enrolment.activatedAt,
      epaDate: enrolment.epaDate,
      approvedMinutes: minutes.approvedMinutes,
      asOf: options.asOf,
    });

    return {
      ...snapshot,
      ...minutes,
      otjPercent: computeOtjPercentOfTarget(
        enrolment.plannedDurationMonths,
        minutes.approvedMinutes,
      ),
    };
  }

  /**
   * Average percentage of target across several enrolments.
   *
   * Enrolments with no planned duration contribute nothing rather than
   * contributing a zero — averaging in an unknown as if it were "no progress"
   * drags a provider's figure down for a data-entry gap.
   */
  async averagePercentForEnrolments(
    enrolments: ReadonlyArray<Pick<Enrolment, 'id' | 'plannedDurationMonths'>>,
  ): Promise<number | null> {
    if (enrolments.length === 0) {
      return null;
    }

    const approvedByEnrolment = await this.approvedMinutesByEnrolment(
      enrolments.map((e) => e.id),
    );

    const percents: number[] = [];
    for (const enrolment of enrolments) {
      const percent = computeOtjPercentOfTarget(
        enrolment.plannedDurationMonths,
        approvedByEnrolment.get(enrolment.id) ?? 0,
      );
      if (percent !== null) {
        percents.push(percent);
      }
    }

    if (percents.length === 0) {
      return null;
    }

    const average =
      percents.reduce((sum, value) => sum + value, 0) / percents.length;
    return Number(average.toFixed(2));
  }
}
