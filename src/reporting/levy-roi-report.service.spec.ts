import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasFundingSyncService } from '../das/das-funding-sync.service.js';
import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { DasLevySyncService } from '../das/das-levy-sync.service.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevySurplusService } from '../levy-exchange/services/levy-surplus.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { LevyRoiBreakdownGroup } from './enums/levy-roi-breakdown-group.enum.js';
import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';
import { LevyRoiReportService } from './levy-roi-report.service.js';
import { LevyRoiYearOnYearService } from './levy-roi-year-on-year.service.js';
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
  const monthlyService = {
    listLast12Months: jest.fn(),
    toMonthlyContributionDtos: jest.fn(),
  };
  const fundingSyncService = {
    getFundingSummary: jest.fn(),
  };
  const surplusService = {
    getSurplus: jest.fn(),
  };
  const otjMetricsService = {
    averageOtjPercentForEnrolments: jest.fn(),
  };
  // F1.4.1 AC1/AC3.
  const epaMetricsService = {
    passRateForEnrolments: jest.fn(),
  };
  const yearOnYearService = {
    compare: jest.fn(),
  };
  const pdfDispatch = {
    enqueue: jest.fn(),
  };
  const enrolmentFind = jest.fn();
  const transferFind = jest.fn();
  const reviewFind = jest.fn().mockResolvedValue([]);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiReportService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DasLevySyncService, useValue: dasSyncService },
        { provide: DasLevyMonthlyService, useValue: monthlyService },
        { provide: DasFundingSyncService, useValue: fundingSyncService },
        { provide: DasLevyForecastService, useValue: forecastService },
        { provide: LevySurplusService, useValue: surplusService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        { provide: EpaOutcomeMetricsService, useValue: epaMetricsService },
        { provide: LevyRoiYearOnYearService, useValue: yearOnYearService },
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
        {
          provide: getRepositoryToken(DasLevyBalance),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(Review),
          useValue: { find: reviewFind },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyRoiReportService);
    jest.clearAllMocks();

    // F1.4.1 — defaults for the two metrics the summary now folds in. Both
    // return "nothing recorded yet", so existing assertions keep describing
    // an organisation with no EPA outcomes and no prior year.
    epaMetricsService.passRateForEnrolments.mockResolvedValue({
      passRate: null,
      assessedCount: 0,
      passCount: 0,
    });
    yearOnYearService.compare.mockResolvedValue({
      currentPeriod: { label: '2025-08 to 2026-07' },
      priorPeriod: null,
      hasPriorPeriodData: false,
      startsChangePercent: null,
      completionsChangePercent: null,
      levySpendChangePercent: null,
      epaPassRatePointChange: null,
    });
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
    monthlyService.listLast12Months.mockResolvedValue([
      { month: new Date('2025-01-01'), contributions: '2000', spend: '500' },
    ]);
    monthlyService.toMonthlyContributionDtos.mockReturnValue([
      { month: '2025-01', amount: 2000, spend: 500 },
    ]);
    fundingSyncService.getFundingSummary.mockResolvedValue({
      totalReceived: 1500,
      lastPaymentDate: '2026-01-15',
      pendingClawbackCount: 0,
      currency: 'GBP',
    });

    const summary = await service.getSummary('org-employer');

    expect(summary.activeApprenticeCount).toBe(1);
    expect(summary.completionCount).toBe(1);
    expect(summary.averageCostPerCompletion).toBe(18000);
    expect(summary.epaPassRate).toBeNull();
    expect(summary.estimatedProductivityUplift).toBe(5000);
    expect(summary.totalLevySpendToDate).toBe(105000);
    expect(summary.monthlyContributions).toEqual([
      { month: '2025-01', amount: 2000 },
    ]);
    expect(summary.fundingSummary.totalReceived).toBe(1500);
  });

  /**
   * F1.4.1 AC1. `epaPassRate` was a hardcoded `null` described as "reserved
   * until EPA outcomes entity exists" — years after the entity and its
   * recording endpoint were built. This asserts the value now comes from the
   * data rather than from a constant.
   */
  it('reports the EPA pass rate from recorded outcomes', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    dasSyncService.getLatestForOrganisation.mockResolvedValue({
      balance: null,
      currency: null,
    });
    forecastService.forecastForOrganisation.mockResolvedValue({
      horizonMonths: 12,
      activeEnrolmentCount: 0,
      projectedMonthlySpend: 0,
      projectedCompletionLiability: 0,
      estimatedRunwayMonths: null,
    });
    surplusService.getSurplus.mockResolvedValue([]);
    enrolmentFind.mockResolvedValue([
      { id: 'enr-1', status: EnrolmentStatus.COMPLETED, agreedPrice: '18000' },
    ]);
    transferFind.mockResolvedValue([]);
    monthlyService.listLast12Months.mockResolvedValue([]);
    monthlyService.toMonthlyContributionDtos.mockReturnValue([]);
    fundingSyncService.getFundingSummary.mockResolvedValue({
      totalReceived: 0,
      lastPaymentDate: null,
      pendingClawbackCount: 0,
      currency: 'GBP',
    });
    epaMetricsService.passRateForEnrolments.mockResolvedValue({
      passRate: 87.5,
      assessedCount: 8,
      passCount: 7,
    });

    const summary = await service.getSummary('org-employer');

    expect(summary.epaPassRate).toBe(87.5);
    expect(summary.epaAssessedCount).toBe(8);
    // Scoped by enrolment id, never by organisation: epa_outcomes rows belong
    // to the provider who recorded the assessment.
    expect(epaMetricsService.passRateForEnrolments).toHaveBeenCalledWith([
      'enr-1',
    ]);
    // AC3 rides along on the same summary.
    expect(summary.yearOnYear.hasPriorPeriodData).toBe(false);
  });

  it('rejects non-employer portal organisations via portal service', async () => {
    portalService.assertPortalType.mockRejectedValue(
      new ForbiddenException('employer only'),
    );

    await expect(service.getSummary('org-provider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns breakdown grouped by provider', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    enrolmentFind.mockResolvedValue([
      {
        id: 'enr-1',
        status: EnrolmentStatus.ACTIVE,
        providerOrganisationId: 'prov-1',
        standardId: 'std-1',
        agreedPrice: '10000',
        apprentice: { status: 'active' },
      },
      {
        id: 'enr-2',
        status: EnrolmentStatus.CANCELLED,
        providerOrganisationId: 'prov-1',
        standardId: 'std-1',
        agreedPrice: null,
        apprentice: { status: 'withdrawn' },
      },
    ]);
    const orgFindBy = jest
      .fn()
      .mockResolvedValue([{ id: 'prov-1', name: 'Provider A' }]);
    const stdFindBy = jest
      .fn()
      .mockResolvedValue([{ id: 'std-1', title: 'Standard 1' }]);
    reviewFind.mockResolvedValue([
      { status: 'completed', scheduledAt: new Date('2026-01-01') },
      { status: 'scheduled', scheduledAt: new Date('2026-01-15') },
    ]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiReportService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DasLevySyncService, useValue: dasSyncService },
        { provide: DasLevyMonthlyService, useValue: monthlyService },
        { provide: DasFundingSyncService, useValue: fundingSyncService },
        { provide: DasLevyForecastService, useValue: forecastService },
        { provide: LevySurplusService, useValue: surplusService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        { provide: EpaOutcomeMetricsService, useValue: epaMetricsService },
        { provide: LevyRoiYearOnYearService, useValue: yearOnYearService },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find: enrolmentFind },
        },
        {
          provide: getRepositoryToken(Standard),
          useValue: { findBy: stdFindBy },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findBy: orgFindBy, findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: { find: transferFind },
        },
        {
          provide: getRepositoryToken(DasLevyBalance),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(Review),
          useValue: { find: reviewFind },
        },
      ],
    }).compile();
    const localService = moduleRef.get(LevyRoiReportService);

    const breakdown = await localService.getBreakdown(
      'org-employer',
      LevyRoiBreakdownGroup.PROVIDER,
    );

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({
      groupId: 'prov-1',
      label: 'Provider A',
      activeApprenticeCount: 1,
      completionCount: 0,
      // 1 of 2 enrolments (any status) is withdrawn/cancelled.
      withdrawalRate: 50,
      // 1 of 2 due reviews reached `completed`.
      reviewComplianceRate: 50,
    });
  });

  it('enqueues PDF export job for employer org', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    pdfDispatch.enqueue.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      template: 'levy_roi_report',
      outputKey: null,
      errorMessage: null,
      createdAt: new Date('2026-01-01'),
      completedAt: null,
    });

    const result = await service.exportPdf({
      id: 'user-1',
      organisationId: 'org-employer',
    } as never);

    expect(result.jobId).toBe('job-1');
    expect(pdfDispatch.enqueue).toHaveBeenCalled();
  });

  it('builds PDF content from summary and breakdowns', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
    dasSyncService.getLatestForOrganisation.mockResolvedValue({
      balance: '100000.00',
      currency: 'GBP',
    });
    forecastService.forecastForOrganisation.mockResolvedValue({
      horizonMonths: 12,
      activeEnrolmentCount: 0,
      projectedMonthlySpend: 0,
      projectedCompletionLiability: 0,
      estimatedRunwayMonths: null,
    });
    surplusService.getSurplus.mockResolvedValue([]);
    enrolmentFind.mockResolvedValue([]);
    transferFind.mockResolvedValue([]);
    const orgFindOne = jest.fn().mockResolvedValue({
      id: 'org-employer',
      name: 'Acme',
      logoUrl: null,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiReportService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DasLevySyncService, useValue: dasSyncService },
        { provide: DasLevyMonthlyService, useValue: monthlyService },
        { provide: DasFundingSyncService, useValue: fundingSyncService },
        { provide: DasLevyForecastService, useValue: forecastService },
        { provide: LevySurplusService, useValue: surplusService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        { provide: EpaOutcomeMetricsService, useValue: epaMetricsService },
        { provide: LevyRoiYearOnYearService, useValue: yearOnYearService },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find: enrolmentFind },
        },
        {
          provide: getRepositoryToken(Standard),
          useValue: { findBy: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findBy: jest.fn(), findOne: orgFindOne },
        },
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: { find: transferFind },
        },
        {
          provide: getRepositoryToken(DasLevyBalance),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(Review),
          useValue: { find: reviewFind },
        },
      ],
    }).compile();
    const localService = moduleRef.get(LevyRoiReportService);

    const content = await localService.buildPdfContent('org-employer');

    expect(content.organisationName).toBe('Acme');
    expect(content.summary).toBeDefined();
  });
});
