import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { LevyRoiBreakdownGroup } from './enums/levy-roi-breakdown-group.enum.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { LevyUtilisationService } from './levy-utilisation.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

describe('LevyUtilisationService', () => {
  let service: LevyUtilisationService;

  const portalService = { assertPortalType: jest.fn() };
  const monthlyService = {
    listLast12Months: jest.fn(),
    toMonthlyContributionDtos: jest.fn(),
  };
  const forecastService = { forecastForOrganisation: jest.fn() };
  const levyRoiReportService = { getBreakdown: jest.fn() };
  const levyBalanceFindOne = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyUtilisationService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DasLevyMonthlyService, useValue: monthlyService },
        { provide: DasLevyForecastService, useValue: forecastService },
        { provide: LevyRoiReportService, useValue: levyRoiReportService },
        {
          provide: getRepositoryToken(DasLevyBalance),
          useValue: { findOne: levyBalanceFindOne },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyUtilisationService);
    jest.clearAllMocks();
  });

  it('assembles utilisation payload for employer orgs', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    levyBalanceFindOne.mockResolvedValue({
      balance: '5000',
      currency: 'GBP',
      utilisationSegments: {
        used: 1000,
        expiringWithin90Days: 500,
        available: 5000,
        currency: 'GBP',
      },
    });
    monthlyService.listLast12Months.mockResolvedValue([
      { month: new Date('2025-01-01'), contributions: '1000', spend: '400' },
    ]);
    monthlyService.toMonthlyContributionDtos.mockReturnValue([
      { month: '2025-01', amount: 1000, spend: 400 },
    ]);
    forecastService.forecastForOrganisation.mockResolvedValue({
      horizonMonths: 12,
      activeEnrolmentCount: 2,
      projectedMonthlySpend: 500,
      projectedCompletionLiability: 1000,
      estimatedRunwayMonths: 10,
    });
    levyRoiReportService.getBreakdown.mockImplementation(
      (_orgId: string, group: LevyRoiBreakdownGroup) => {
        if (group === LevyRoiBreakdownGroup.PROVIDER) {
          return Promise.resolve([
            {
              groupId: 'prov-1',
              label: 'Provider A',
              activeApprenticeCount: 1,
              completionCount: 0,
              averageCostPerCompletion: null,
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const result = await service.getUtilisation('org-employer');

    expect(result.organisationId).toBe('org-employer');
    expect(result.segments.used).toBe(1000);
    expect(result.monthlySeries).toEqual([
      { month: '2025-01', contributions: 1000, spend: 400 },
    ]);
    expect(result.costPerApprentice.length).toBeGreaterThan(0);
  });

  it('rejects non-employer portal organisations', async () => {
    portalService.assertPortalType.mockRejectedValue(
      new ForbiddenException('employer only'),
    );

    await expect(service.getUtilisation('org-provider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
