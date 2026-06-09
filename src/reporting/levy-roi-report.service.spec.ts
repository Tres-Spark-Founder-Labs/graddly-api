import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevySyncService } from '../das/das-levy-sync.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevySurplusService } from '../levy-exchange/services/levy-surplus.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { Standard } from '../programmes/entities/standard.entity.js';

import { LevyRoiReportService } from './levy-roi-report.service.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

describe('LevyRoiReportService', () => {
  let service: LevyRoiReportService;

  const portalService = {
    assertPortalType: jest.fn(),
  };
  const dasSyncService = {
    getLatestForOrganisation: jest.fn(),
  };
  const forecastService = {
    forecastForOrganisation: jest.fn(),
  };
  const surplusService = {
    getSurplus: jest.fn(),
  };
  const otjMetricsService = {
    averageOtjPercentForEnrolments: jest.fn(),
  };
  const pdfDispatch = {
    enqueue: jest.fn(),
  };
  const enrolmentFind = jest.fn();
  const transferFind = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiReportService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DasLevySyncService, useValue: dasSyncService },
        { provide: DasLevyForecastService, useValue: forecastService },
        { provide: LevySurplusService, useValue: surplusService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find: enrolmentFind },
        },
        {
          provide: getRepositoryToken(Standard),
          useValue: { findBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findBy: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: { find: transferFind },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyRoiReportService);
    jest.clearAllMocks();
  });

  it('aggregates summary metrics for employer portal orgs', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    dasSyncService.getLatestForOrganisation.mockResolvedValue({
      balance: '100000.00',
      currency: 'GBP',
    });
    forecastService.forecastForOrganisation.mockResolvedValue({
      horizonMonths: 12,
      activeEnrolmentCount: 2,
      projectedMonthlySpend: 5000,
      projectedCompletionLiability: 10000,
      estimatedRunwayMonths: 20,
    });
    surplusService.getSurplus.mockResolvedValue([]);
    enrolmentFind.mockResolvedValue([
      { status: EnrolmentStatus.ACTIVE, agreedPrice: '15000' },
      { status: EnrolmentStatus.COMPLETED, agreedPrice: '18000' },
    ]);
    transferFind.mockResolvedValue([{ amount: '5000.00' }]);

    const summary = await service.getSummary('org-employer');

    expect(summary.activeApprenticeCount).toBe(1);
    expect(summary.completionCount).toBe(1);
    expect(summary.averageCostPerCompletion).toBe(18000);
    expect(summary.epaPassRate).toBeNull();
    expect(summary.estimatedProductivityUplift).toBe(5000);
    expect(summary.totalLevySpendToDate).toBe(105000);
    expect(summary.monthlyContributions).toEqual([]);
  });

  it('rejects non-employer portal organisations via portal service', async () => {
    portalService.assertPortalType.mockRejectedValue(
      new ForbiddenException('employer only'),
    );

    await expect(service.getSummary('org-provider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
