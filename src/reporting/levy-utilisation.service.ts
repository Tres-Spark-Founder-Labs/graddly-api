import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { LevyRoiBreakdownGroup } from './enums/levy-roi-breakdown-group.enum.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type { LevyUtilisationResponseDto } from './dto/levy-utilisation-response.dto.js';

@Injectable()
export class LevyUtilisationService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly monthlyService: DasLevyMonthlyService,
    private readonly forecastService: DasLevyForecastService,
    private readonly levyRoiReportService: LevyRoiReportService,
    @InjectRepository(DasLevyBalance)
    private readonly levyBalanceRepo: Repository<DasLevyBalance>,
  ) {}

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
      forecast,
      providerBreakdown,
      standardBreakdown,
    ] = await Promise.all([
      this.levyBalanceRepo.findOne({
        where: { organisationId, isDeleted: false },
      }),
      this.monthlyService.listLast12Months(organisationId),
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

    const segments = balance?.utilisationSegments ?? {
      used: 0,
      expiringWithin90Days: 0,
      available: balance?.balance ? Number(balance.balance) : 0,
      currency: balance?.currency ?? 'GBP',
    };

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
