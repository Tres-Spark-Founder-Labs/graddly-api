import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentJourneyService } from '../enrolments/enrolment-journey.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { Review } from '../reviews/entities/review.entity.js';

import { LearnerMeSummaryService } from './learner-me-summary.service.js';

describe('LearnerMeSummaryService', () => {
  let service: LearnerMeSummaryService;

  const portalService = { assertPortalType: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };
  const reviewRepo = { findOne: jest.fn() };
  const journeyService = { getJourney: jest.fn() };
  const otjMetrics = { percentForEnrolment: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerMeSummaryService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: EnrolmentJourneyService, useValue: journeyService },
        { provide: OtjProgressMetricsService, useValue: otjMetrics },
      ],
    }).compile();

    service = moduleRef.get(LearnerMeSummaryService);
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
  });

  it('requires provider portal organisation', async () => {
    portalService.assertPortalType.mockRejectedValue(new ForbiddenException());

    await expect(
      service.getSummary({ id: 'user-1', organisationId: 'org-1' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asserts provider portal type', async () => {
    enrolmentRepo.findOne.mockResolvedValue(null);

    await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    expect(portalService.assertPortalType).toHaveBeenCalledWith(
      'org-1',
      PortalType.PROVIDER,
    );
  });

  it('returns empty summary when no active enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue(null);

    const result = await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    expect(result.activeEnrolmentId).toBeNull();
    expect(result.otjPace.approvedMinutes).toBe(0);
  });

  it('returns summary for active enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enrol-1',
      apprenticeId: 'app-1',
      status: EnrolmentStatus.ACTIVE,
      standard: { title: 'Software Developer' },
    });
    journeyService.getJourney.mockResolvedValue({
      pace: {
        alertLevel: OtjPaceAlertLevel.ON_TRACK,
        approvedMinutes: 900,
      },
      daysToEpa: 120,
      epaDate: '2026-12-01',
    });
    otjMetrics.percentForEnrolment.mockResolvedValue(55);
    reviewRepo.findOne.mockResolvedValue({
      scheduledAt: new Date('2026-08-01T10:00:00Z'),
    });

    const result = await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    expect(result.activeEnrolmentId).toBe('enrol-1');
    expect(result.activeApprenticeId).toBe('app-1');
    expect(result.programmeTitle).toBe('Software Developer');
    expect(result.otjPace.otjPercent).toBe(55);
    expect(result.daysToEpa).toBe(120);
  });
});
