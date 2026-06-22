import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasFundingSyncService } from '../das/das-funding-sync.service.js';
import { LearnerMetricsService } from '../learners/learner-metrics.service.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';
import { FundingClaimStatus } from './enums/funding-claim-status.enum.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';
import { SmeOverviewService } from './sme-overview.service.js';

describe('SmeOverviewService', () => {
  let service: SmeOverviewService;

  const portalService = {
    assertPortalType: jest.fn(),
  };
  const learnerMetrics = {
    loadActiveEnrolments: jest.fn(),
    buildContext: jest.fn(),
  };
  const otjMetrics = {
    percentForEnrolment: jest.fn(),
  };
  const pipelineService = {
    countByPipelineStatus: jest.fn(),
  };
  const fundingSyncService = {
    getFundingSummary: jest.fn(),
    deriveFundingClaimStatus: jest.fn(),
  };
  const otjLogRepo = {
    findAndCount: jest.fn(),
  };
  const reviewRepo = {
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SmeOverviewService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: LearnerMetricsService, useValue: learnerMetrics },
        { provide: OtjProgressMetricsService, useValue: otjMetrics },
        { provide: CommitmentPipelineService, useValue: pipelineService },
        { provide: DasFundingSyncService, useValue: fundingSyncService },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjLogRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
      ],
    }).compile();

    service = moduleRef.get(SmeOverviewService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.FLOW,
    });
    fundingSyncService.getFundingSummary.mockResolvedValue({
      totalReceived: 0,
      lastPaymentDate: null,
      pendingClawbackCount: 0,
      currency: 'GBP',
    });
    fundingSyncService.deriveFundingClaimStatus.mockReturnValue('no_payments');
  });

  it('requires Flow portal type', async () => {
    portalService.assertPortalType.mockRejectedValue(new ForbiddenException());

    await expect(service.getOverview('org-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns summary and apprentice rows', async () => {
    const enrolment = {
      id: 'enrol-1',
      apprentice: { firstName: 'Alex', lastName: 'Apprentice' },
      standard: { title: 'Software Developer' },
      plannedDurationMonths: 18,
    };

    learnerMetrics.loadActiveEnrolments.mockResolvedValue([enrolment]);
    learnerMetrics.buildContext.mockResolvedValue({
      enrolment,
      nextReviewDate: new Date('2026-06-15'),
      statusBadge: 'on_track',
    });
    otjMetrics.percentForEnrolment.mockResolvedValue(55.5);
    otjLogRepo.findAndCount.mockResolvedValue([[], 0]);
    reviewRepo.count.mockResolvedValue(2);
    pipelineService.countByPipelineStatus.mockResolvedValue({
      [CommitmentPipelineStatus.NONE]: 1,
      [CommitmentPipelineStatus.DRAFT]: 0,
      [CommitmentPipelineStatus.AWAITING_SIGNATURES]: 0,
      [CommitmentPipelineStatus.SIGNED]: 0,
      [CommitmentPipelineStatus.CANCELLED]: 0,
    });

    const result = await service.getOverview('org-flow');

    expect(portalService.assertPortalType).toHaveBeenCalledWith(
      'org-flow',
      PortalType.FLOW,
    );
    expect(result.summary.activeApprenticeCount).toBe(1);
    expect(result.summary.reviewsDueThisMonthCount).toBe(2);
    expect(result.summary.fundingClaimStatus).toBe(
      FundingClaimStatus.NO_PAYMENTS,
    );
    expect(result.apprentices[0]?.learnerName).toBe('Alex Apprentice');
    expect(result.apprentices[0]?.otjPercent).toBe(55.5);
  });
});
