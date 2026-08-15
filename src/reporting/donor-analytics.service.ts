import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { LevyRecipientProfile } from '../levy-exchange/entities/levy-recipient-profile.entity.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../levy-exchange/enums/levy-transfer-status.enum.js';
import { LevyTransferFundingService } from '../levy-exchange/services/levy-transfer-funding.service.js';

import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';

import type {
  DonorAnalyticsBreakdownDto,
  DonorAnalyticsSummaryDto,
} from './dto/donor-analytics-response.dto.js';

/**
 * F4.1.4 — the donor analytics portal.
 *
 * ── WHY THIS LIVES IN `reporting` AND NOT `levy-exchange` ───────────────────
 *
 * It needs `EpaOutcomeMetricsService`, which lives here, and `ReportingModule`
 * already imports `LevyExchangeModule`. Putting it the other way round would
 * make those two modules import each other. It also belongs here on its own
 * merits: this is a report, assembled from levy data, not a levy operation.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * AC3 asks for an ESG impact card — "estimated productivity uplift" and a
 * "social mobility score (Sutton Trust methodology)". Neither is defined
 * anywhere, and the Sutton Trust publishes research rather than a scoring
 * algorithm for levy transfers. AC4 exports this report for a donor's *annual
 * ESG report*, so an invented score would be published to their stakeholders
 * with our name behind the methodology. It is deferred pending client decision
 * 19 rather than guessed. See `DECISIONS-FOR-CLIENT.md`.
 */

/** A transfer only counts as money spent once it is confirmed or active. */
const FUNDING_STATUSES = [
  LevyTransferStatus.CONFIRMED,
  LevyTransferStatus.ACTIVE,
];

@Injectable()
export class DonorAnalyticsService {
  constructor(
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(LevyRecipientProfile)
    private readonly recipientProfileRepo: Repository<LevyRecipientProfile>,
    private readonly fundingService: LevyTransferFundingService,
    private readonly epaMetrics: EpaOutcomeMetricsService,
  ) {}

  /**
   * F4.1.4 AC1 — the five headline figures.
   *
   * Completion rate and EPA pass rate are computed over the enrolments this
   * donor actually funded, not over the recipient SMEs' whole cohorts. An SME
   * that takes one funded learner and twenty of its own is not evidence about
   * the donor's money either way.
   */
  async getSummary(
    donorOrganisationId: string,
  ): Promise<DonorAnalyticsSummaryDto> {
    const [transfers, counts, fundedEnrolmentIds] = await Promise.all([
      this.transferRepo.find({
        where: {
          donorOrganisationId,
          status: In(FUNDING_STATUSES),
          isDeleted: false,
        },
      }),
      this.fundingService.countForDonor(donorOrganisationId),
      this.fundingService.fundedEnrolmentIds(donorOrganisationId),
    ]);

    const totalTransferred = transfers.reduce(
      (sum, t) => sum + Number(t.amount ?? 0),
      0,
    );

    /**
     * Distinct recipients of *funded* transfers, which is not the same as the
     * recipients who have learners linked. An SME that received money but has
     * not enrolled anyone yet has still been funded, and excluding it would
     * under-report the donor's reach.
     */
    const smesFunded = new Set(transfers.map((t) => t.recipientOrganisationId))
      .size;

    const [enrolments, epa] = await Promise.all([
      fundedEnrolmentIds.length
        ? this.enrolmentRepo.find({
            where: { id: In(fundedEnrolmentIds), isDeleted: false },
            select: ['id', 'status'],
          })
        : Promise.resolve([]),
      this.epaMetrics.passRateForEnrolments(fundedEnrolmentIds),
    ]);

    const completedCount = enrolments.filter(
      (e) => e.status === EnrolmentStatus.COMPLETED,
    ).length;

    return {
      totalTransferred: round2(totalTransferred),
      smesFunded,
      learnersFunded: counts.learnersFunded,
      completedCount,
      /**
       * Null rather than 0 when nothing has been funded yet. A completion rate
       * of "0%" reads as failure; "not applicable" is the truth, and this
       * figure is published.
       */
      completionRate:
        enrolments.length > 0
          ? round2((completedCount / enrolments.length) * 100)
          : null,
      epaPassRate: epa.passRate,
      epaAssessedCount: epa.assessedCount,
      /**
       * AC3. Always null until client decision 19 supplies a methodology —
       * present in the contract so the shape does not change when it arrives,
       * and explicitly null so no consumer mistakes an absent value for zero.
       */
      esgImpact: null,
    };
  }

  /**
   * F4.1.4 AC2 — breakdown by sector, region and programme type.
   *
   * Sector and region come from the recipient's profile, because a transfer
   * does not carry them. That has a consequence worth knowing: a recipient
   * that edits its profile changes the historical breakdown, since these are
   * read live rather than captured at the time of transfer. Freezing them
   * would mean copying sector/region onto the transfer row at confirmation —
   * a deliberate change, not something to do silently here.
   *
   * Programme type comes from `programmeDetails` JSON, which is unstructured;
   * transfers with nothing usable are grouped under "Unspecified" rather than
   * dropped, so the parts always sum to the whole.
   */
  async getBreakdown(
    donorOrganisationId: string,
  ): Promise<DonorAnalyticsBreakdownDto> {
    const transfers = await this.transferRepo.find({
      where: {
        donorOrganisationId,
        status: In(FUNDING_STATUSES),
        isDeleted: false,
      },
    });

    const recipientIds = [
      ...new Set(transfers.map((t) => t.recipientOrganisationId)),
    ];
    const profiles = recipientIds.length
      ? await this.recipientProfileRepo.find({
          where: { organisationId: In(recipientIds), isDeleted: false },
        })
      : [];
    const profileByOrg = new Map(profiles.map((p) => [p.organisationId, p]));

    const bySector = new Map<string, number>();
    const byRegion = new Map<string, number>();
    const byProgrammeType = new Map<string, number>();

    for (const transfer of transfers) {
      const amount = Number(transfer.amount ?? 0);
      const profile = profileByOrg.get(transfer.recipientOrganisationId);

      add(bySector, profile?.sector ?? 'Unspecified', amount);
      add(byRegion, profile?.region ?? 'Unspecified', amount);
      add(
        byProgrammeType,
        resolveProgrammeType(transfer.programmeDetails),
        amount,
      );
    }

    return {
      bySector: toRows(bySector),
      byRegion: toRows(byRegion),
      byProgrammeType: toRows(byProgrammeType),
    };
  }
}

function add(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function toRows(map: Map<string, number>) {
  return [...map.entries()]
    .map(([label, amount]) => ({ label, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * `programmeDetails` is free-form JSON written by whoever created the
 * transfer. Only strings are accepted — a nested object stringified into a
 * chart label is worse than "Unspecified".
 */
function resolveProgrammeType(details: Record<string, unknown> | null): string {
  if (!details) return 'Unspecified';
  for (const key of ['title', 'programmeType', 'standard']) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Unspecified';
}

/** Money and percentages, to two places. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
