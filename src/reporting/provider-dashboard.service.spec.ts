import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { LearnerMetricsService } from '../learners/learner-metrics.service.js';
import { EifScoreCalculatorService } from '../ofsted/eif-score-calculator.service.js';
import { EifRag } from '../ofsted/enums/eif-rag.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { ProviderDashboardService } from './provider-dashboard.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

describe('ProviderDashboardService', () => {
  let service: ProviderDashboardService;

  const portalService = { assertPortalType: jest.fn() };
  const learnerMetrics = {
    loadActiveEnrolments: jest.fn(),
    buildContext: jest.fn(),
  };
  const eifCalculator = { calculate: jest.fn() };
  const ilrRecordRepo = { count: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderDashboardService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: LearnerMetricsService, useValue: learnerMetrics },
        { provide: EifScoreCalculatorService, useValue: eifCalculator },
        {
          provide: getRepositoryToken(IlrLearnerRecord),
          useValue: ilrRecordRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(ProviderDashboardService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
    eifCalculator.calculate.mockResolvedValue({ overallPercent: 82 });
    ilrRecordRepo.count.mockResolvedValue(3);
  });

  it('requires provider portal type', async () => {
    portalService.assertPortalType.mockRejectedValue(new ForbiddenException());

    await expect(service.getDashboard('org-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns cohort, at-risk, EIF, and ILR counts', async () => {
    const enrolment = { id: 'enrol-1' };
    learnerMetrics.loadActiveEnrolments.mockResolvedValue([
      enrolment,
      enrolment,
    ]);
    learnerMetrics.buildContext
      .mockResolvedValueOnce({ severityScore: 5 })
      .mockResolvedValueOnce({ severityScore: 0 });

    const result = await service.getDashboard('provider-1');

    expect(result.summary.cohortCount).toBe(2);
    expect(result.summary.atRiskCount).toBe(1);
    expect(result.summary.eifOverallPercent).toBe(82);
    expect(result.summary.eifOverallRag).toBe(EifRag.GREEN);
    expect(result.summary.ilrPendingCount).toBe(3);
  });
});
