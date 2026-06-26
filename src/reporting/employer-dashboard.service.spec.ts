import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { EmployerDashboardService } from './employer-dashboard.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';
import { ReportingPortalService } from './reporting-portal.service.js';

describe('EmployerDashboardService', () => {
  let service: EmployerDashboardService;

  const portalService = { assertPortalType: jest.fn() };
  const pipelineService = {
    countByPipelineStatusForEmployer: jest.fn(),
  };
  const enrolmentRepo = { find: jest.fn() };
  const otjLogRepo = { count: jest.fn() };
  const reviewRepo = { count: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmployerDashboardService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: CommitmentPipelineService, useValue: pipelineService },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjLogRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: enrolmentRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(EmployerDashboardService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.EMPLOYER,
    });
  });

  it('requires employer portal type', async () => {
    portalService.assertPortalType.mockRejectedValue(new ForbiddenException());

    await expect(service.getDashboard('org-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns summary counts for linked enrolments', async () => {
    enrolmentRepo.find.mockResolvedValue([
      { id: 'enrol-1', organisationId: 'provider-1' },
    ]);
    otjLogRepo.count.mockResolvedValue(2);
    reviewRepo.count.mockResolvedValue(1);
    pipelineService.countByPipelineStatusForEmployer.mockResolvedValue({
      [CommitmentPipelineStatus.NONE]: 0,
      [CommitmentPipelineStatus.DRAFT]: 1,
      [CommitmentPipelineStatus.AWAITING_SIGNATURES]: 0,
      [CommitmentPipelineStatus.SIGNED]: 0,
      [CommitmentPipelineStatus.CANCELLED]: 0,
    });

    const result = await service.getDashboard('employer-1');

    expect(result.summary.activeApprenticeCount).toBe(1);
    expect(result.summary.pendingOtjApprovalCount).toBe(2);
    expect(result.summary.reviewsAwaitingActionCount).toBe(1);
    expect(result.summary.commitmentPipeline.draft).toBe(1);
  });
});
