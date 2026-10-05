import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { DasLevyTranche } from '../levy-exchange/entities/das-levy-tranche.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { LevyRoiBreakdownGroup } from './enums/levy-roi-breakdown-group.enum.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type { LevyUtilisationResponseDto } from './dto/levy-utilisation-response.dto.js';
import type { IDasUtilisationSegments } from '../das/types/das-utilisation-segments.types.js';

@Injectable()
export class LevyUtilisationService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly monthlyService: DasLevyMonthlyService,
    private readonly forecastService: DasLevyForecastService,
    private readonly levyRoiReportService: LevyRoiReportService,
    @InjectRepository(DasLevyBalance)
    private readonly levyBalanceRepo: Repository<DasLevyBalance>,
    @InjectRepository(DasLevyTranche)
    private readonly trancheRepo: Repository<DasLevyTranche>,
  ) {}

  /**
   * Utilisation from hand-entered figures.
   *
   *   used        the spend recorded month by month, which is the only record
   *               of money leaving the account in manual mode
   *   expiring    the scheduled tranches falling inside the 90-day window, the
   *               same window F1.1.2 warns on
   *   available   the balance as entered
   *
   * Deliberately derived on read rather than written on save: the three pieces
   * are entered on three different forms in any order, and a figure computed
   * at save time would be stale the moment the next form was submitted.
   */
  private deriveSegmentsFromManualEntry(
    monthlySeries: { spend: number }[],
    tranches: DasLevyTranche[],
    balance: DasLevyBalance | null,
  ): IDasUtilisationSegments {
    const round = (value: number) => Math.round(value * 100) / 100;

    const used = monthlySeries.reduce(
      (total, row) => total + (Number(row.spend) || 0),
      0,
    );

    const today = new Date();
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 90);
    const todayIso = today.toISOString().slice(0, 10);
    const horizonIso = horizon.toISOString().slice(0, 10);

    const expiringWithin90Days = tranches
      .filter(
        (tranche) =>
          tranche.expiresOn >= todayIso && tranche.expiresOn <= horizonIso,
      )
      .reduce((total, tranche) => total + (Number(tranche.amount) || 0), 0);

    return {
      used: round(used),
      expiringWithin90Days: round(expiringWithin90Days),
      available: balance?.balance ? Number(balance.balance) : 0,
      currency: balance?.currency ?? 'GBP',
    };
  }

  async getUtilisation(
    organisationId: string,
  ): Promise<LevyUtilisationResponseDto> {
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.EMPLOYER,
    );

    const [
      balance,
      monthlyEntries,
      tranches,
      forecast,
      providerBreakdown,
      standardBreakdown,
    ] = await Promise.all([
      this.levyBalanceRepo.findOne({
        where: { organisationId, isDeleted: false },
      }),
      this.monthlyService.listLast12Months(organisationId),
      this.trancheRepo.find({
        where: { organisationId, isDeleted: false },
      }),
      this.forecastService.forecastForOrganisation(organisationId),
      this.levyRoiReportService.getBreakdown(
        organisationId,
        LevyRoiBreakdownGroup.PROVIDER,
      ),
      this.levyRoiReportService.getBreakdown(
        organisationId,
        LevyRoiBreakdownGroup.STANDARD,
      ),
    ]);

    const monthlySeries = this.monthlyService
      .toMonthlyContributionDtos(monthlyEntries)
      .map((row) => ({
        month: row.month,
        contributions: row.amount,
        spend: row.spend,
      }));

    /**
     * ── WHERE THE SEGMENTS COME FROM ──────────────────────────────────────
     *
     * `utilisationSegments` is parsed out of a DAS payload, so it is null for
     * every hand-entered account — and under D-05 that is every account. The
     * dashboard therefore read "0% used" no matter what the employer typed:
     * the figures were in the database and nothing looked at them.
     *
     * So when there is no synced payload, the segments are derived from the
     * figures the employer did enter, and the response says which happened.
     * A screen that cannot tell a typed figure from an ESFA one will present
     * both as fact, which is the thing to avoid.
     */
    const derived = this.deriveSegmentsFromManualEntry(
      monthlySeries,
      tranches,
      balance,
    );
    const segments = balance?.utilisationSegments ?? derived;
    const segmentsSource: 'das' | 'manual' | 'unavailable' =
      balance?.utilisationSegments ? 'das' : balance ? 'manual' : 'unavailable';

    const costPerApprentice = [
      ...standardBreakdown.map((row) => ({
        groupId: row.groupId,
        label: row.label,
        groupType: 'standard' as const,
        averageCost: row.averageCostPerCompletion,
        apprenticeCount: row.activeApprenticeCount + row.completionCount,
      })),
      ...providerBreakdown.map((row) => ({
        groupId: row.groupId,
        label: row.label,
        groupType: 'provider' as const,
        averageCost: row.averageCostPerCompletion,
        apprenticeCount: row.activeApprenticeCount + row.completionCount,
      })),
    ];

    return {
      organisationId,
      segments,
      segmentsSource,
      monthlySeries,
      forecast: {
        horizonMonths: forecast.horizonMonths,
        activeEnrolmentCount: forecast.activeEnrolmentCount,
        projectedMonthlySpend: forecast.projectedMonthlySpend,
        projectedCompletionLiability: forecast.projectedCompletionLiability,
        estimatedRunwayMonths: forecast.estimatedRunwayMonths,
      },
      costPerApprentice,
      generatedAt: new Date().toISOString(),
    };
  }
}
