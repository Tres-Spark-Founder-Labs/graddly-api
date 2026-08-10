import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentJourneyService } from '../enrolments/enrolment-journey.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';
import { OtjSummaryService } from '../otj/otj-summary.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { Review } from '../reviews/entities/review.entity.js';

import { LearnerMeSummaryService } from './learner-me-summary.service.js';

describe('LearnerMeSummaryService', () => {
  let service: LearnerMeSummaryService;

  const portalService = { assertPortalType: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };
  const reviewRepo = { findOne: jest.fn() };
  const journeyService = { getJourney: jest.fn() };
  /**
   * P0-A — the summary now takes every OTJ figure from one call to the shared
   * pace service, rather than combining an approved-minutes total from the
   * journey service with a percentage from the reporting metrics service.
   */
  const otjSummary = { paceForEnrolment: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerMeSummaryService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: EnrolmentJourneyService, useValue: journeyService },
        { provide: OtjSummaryService, useValue: otjSummary },
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
    otjSummary.paceForEnrolment.mockResolvedValue({
      alertLevel: OtjPaceAlertLevel.ON_TRACK,
      otjPercent: 55,
      approvedMinutes: 900,
      loggedMinutes: 1500,
      pendingMinutes: 500,
      rejectedMinutes: 100,
    });
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

  /**
   * P0-A — the three new fields reach the response unmodified.
   *
   * Distinct values per field, deliberately: equal ones would pass even if the
   * service assigned the same figure to all three.
   */
  it('passes every minute figure through from the shared pace service', async () => {
    portalService.assertPortalType.mockResolvedValue(undefined);
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enrol-1',
      apprenticeId: 'app-1',
      status: EnrolmentStatus.ACTIVE,
      standard: { title: 'Software Developer' },
    });
    journeyService.getJourney.mockResolvedValue({
      pace: { alertLevel: OtjPaceAlertLevel.ON_TRACK, approvedMinutes: 900 },
      daysToEpa: 120,
      epaDate: '2026-12-01',
    });
    otjSummary.paceForEnrolment.mockResolvedValue({
      alertLevel: OtjPaceAlertLevel.AT_RISK,
      otjPercent: 42.5,
      approvedMinutes: 900,
      loggedMinutes: 1500,
      pendingMinutes: 500,
      rejectedMinutes: 100,
    });
    reviewRepo.findOne.mockResolvedValue(null);

    const result = await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    expect(result.otjPace).toEqual({
      alertLevel: OtjPaceAlertLevel.AT_RISK,
      otjPercent: 42.5,
      approvedMinutes: 900,
      loggedMinutes: 1500,
      pendingMinutes: 500,
      rejectedMinutes: 100,
    });
  });

  /**
   * The alert level comes from the shared pace service, not from the journey
   * service, so the two cannot disagree on one screen. Asserted by making them
   * differ: the journey says on-track, the pace service says at-risk, and the
   * response must follow the pace service.
   */
  it('takes the alert level from the pace service, not the journey', async () => {
    portalService.assertPortalType.mockResolvedValue(undefined);
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enrol-1',
      apprenticeId: 'app-1',
      status: EnrolmentStatus.ACTIVE,
      standard: { title: 'Software Developer' },
    });
    journeyService.getJourney.mockResolvedValue({
      pace: { alertLevel: OtjPaceAlertLevel.ON_TRACK, approvedMinutes: 0 },
      daysToEpa: 10,
      epaDate: '2026-12-01',
    });
    otjSummary.paceForEnrolment.mockResolvedValue({
      alertLevel: OtjPaceAlertLevel.OFF_TRACK,
      otjPercent: 3,
      approvedMinutes: 60,
      loggedMinutes: 60,
      pendingMinutes: 0,
      rejectedMinutes: 0,
    });
    reviewRepo.findOne.mockResolvedValue(null);

    const result = await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    expect(result.otjPace.alertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
  });

  it('reports zeros, not nulls, when there is no active enrolment', async () => {
    portalService.assertPortalType.mockResolvedValue(undefined);
    enrolmentRepo.findOne.mockResolvedValue(null);

    const result = await service.getSummary({
      id: 'user-1',
      organisationId: 'org-1',
    } as never);

    // Minutes genuinely are zero here — the learner has no programme to have
    // logged against. `otjPercent` stays null because it is unknowable, which
    // is the distinction the frontend renders as "—" rather than "0%".
    expect(result.otjPace).toEqual({
      alertLevel: null,
      otjPercent: null,
      approvedMinutes: 0,
      loggedMinutes: 0,
      pendingMinutes: 0,
      rejectedMinutes: 0,
    });
  });
});
