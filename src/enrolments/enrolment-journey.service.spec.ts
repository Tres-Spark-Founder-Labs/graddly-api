import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';
import { JourneyMilestoneStatus } from './enums/journey-milestone-status.enum.js';

describe('EnrolmentJourneyService', () => {
  let service: EnrolmentJourneyService;
  const enrolmentsService = { findOne: jest.fn() };
  const enrolmentRepo = { save: jest.fn() };
  const standardRepo = { findOne: jest.fn() };
  const otjRepo = {
    createQueryBuilder: jest.fn(),
  };
  const commitmentGroupRepo = { findOne: jest.fn() };
  const commitmentRepo = { findOne: jest.fn() };
  const reviewRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const membershipRepo = { find: jest.fn() };
  const notifications = { createForUser: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentJourneyService,
        { provide: EnrolmentsService, useValue: enrolmentsService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Standard), useValue: standardRepo },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: commitmentGroupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentJourneyService);
    jest.clearAllMocks();

    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '2400' }),
    });
    commitmentGroupRepo.findOne.mockResolvedValue(null);
    reviewRepo.find.mockResolvedValue([]);
    reviewRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    standardRepo.findOne.mockResolvedValue({ gatewayCriteria: null });
    enrolmentRepo.save.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );
    membershipRepo.find.mockResolvedValue([]);
  });

  it('returns journey with milestones, checklist, and EPA countdown', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: new Date('2025-01-15T00:00:00.000Z'),
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
      plannedDurationMonths: 18,
      epaDate: '2026-09-01',
      completedAt: null,
      gatewayReadyNotifiedAt: null,
    } as Enrolment;

    enrolmentsService.findOne.mockResolvedValue(enrolment);

    const journey = await service.getJourney(
      { id: 'u1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(journey.enrolmentId).toBe('enr-1');
    expect(journey.epaDate).toBe('2026-09-01');
    expect(journey.daysToEpa).not.toBeNull();
    expect(journey.milestones.length).toBeGreaterThan(0);
    expect(journey.gatewayChecklist.length).toBe(4);
    expect(journey.pace.approvedMinutes).toBe(2400);
  });

  it('updates EPA date via patch journey flow', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: new Date('2025-01-15T00:00:00.000Z'),
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
      plannedDurationMonths: 18,
      epaDate: null,
      completedAt: null,
      gatewayReadyNotifiedAt: null,
    } as Enrolment;

    enrolmentsService.findOne.mockResolvedValue(enrolment);

    const journey = await service.updateJourney(
      { id: 'u1', organisationId: 'org-1' } as never,
      'enr-1',
      { epaDate: '2026-06-01' },
    );

    expect(enrolment.epaDate).toBe('2026-06-01');
    expect(journey.epaDate).toBe('2026-06-01');
    expect(journey.epaCountdownBand).not.toBe('unset');
  });

  /** An enrolment with none of the gateway criteria met unless overridden. */
  function buildEnrolment(overrides: Partial<Enrolment> = {}): Enrolment {
    return {
      id: 'enr-1',
      organisationId: 'org-1',
      providerOrganisationId: 'org-provider',
      standardId: 'std-1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: new Date('2025-01-15T00:00:00.000Z'),
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
      plannedDurationMonths: 18,
      epaDate: '2026-09-01',
      completedAt: null,
      gatewayReadyAt: null,
      gatewayReadyNotifiedAt: null,
      ...overrides,
    } as Enrolment;
  }

  /** Makes all four default gateway criteria evaluate complete. */
  function makeGatewayReady(): void {
    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '99999999' }),
    });
    commitmentGroupRepo.findOne.mockResolvedValue({
      currentVersion: { status: CommitmentStatementStatus.SIGNED },
    });
    reviewRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
  }

  function review(overrides: Partial<Review>): Review {
    return {
      id: 'rev-1',
      title: '12-weekly review',
      reviewType: 'progress',
      scheduledAt: new Date('2025-06-01T10:00:00.000Z'),
      status: ReviewStatus.SCHEDULED,
      ...overrides,
    } as Review;
  }

  /**
   * Client decision Q2 — the timeline is sourced from the reviews that exist,
   * and a review whose date passed without it being held is marked overdue
   * rather than left indistinguishable from one still to come.
   */
  describe('Q2 — review milestones reflect what actually happened', () => {
    const user = { id: 'u1', organisationId: 'org-1' } as never;

    async function statusesFor(reviews: Review[]) {
      reviewRepo.find.mockResolvedValue(reviews);
      enrolmentsService.findOne.mockResolvedValue(buildEnrolment());
      const journey = await service.getJourney(user, 'enr-1');
      return journey.milestones
        .filter((m) => m.code.startsWith('review_'))
        .map((m) => m.status);
    }

    it('marks a past, unheld review overdue', async () => {
      const statuses = await statusesFor([
        review({ scheduledAt: new Date('2020-01-01T00:00:00.000Z') }),
      ]);
      expect(statuses).toEqual([JourneyMilestoneStatus.OVERDUE]);
    });

    it('leaves a future review upcoming', async () => {
      const statuses = await statusesFor([
        review({ scheduledAt: new Date('2099-01-01T00:00:00.000Z') }),
      ]);
      expect(statuses).toEqual([JourneyMilestoneStatus.UPCOMING]);
    });

    it('marks a completed review complete even if it was held late', async () => {
      const statuses = await statusesFor([
        review({
          scheduledAt: new Date('2020-01-01T00:00:00.000Z'),
          status: ReviewStatus.COMPLETED,
        }),
      ]);
      expect(statuses).toEqual([JourneyMilestoneStatus.COMPLETE]);
    });

    /**
     * The regression this replaces: a cancelled review was reported as
     * `upcoming`, telling the apprentice a review was still to come when it
     * had been called off.
     */
    it('does not report a cancelled review as upcoming', async () => {
      const statuses = await statusesFor([
        review({
          scheduledAt: new Date('2020-01-01T00:00:00.000Z'),
          status: ReviewStatus.CANCELLED,
        }),
      ]);
      expect(statuses).toEqual([JourneyMilestoneStatus.CANCELLED]);
    });

    /**
     * The other half of that regression: every non-completed review was
     * reported as `current`, so an apprentice with several scheduled reviews
     * saw several simultaneous "current" stages.
     */
    it('does not mark every outstanding review as current', async () => {
      const statuses = await statusesFor([
        review({ id: 'r1', scheduledAt: new Date('2099-01-01T00:00:00.000Z') }),
        review({ id: 'r2', scheduledAt: new Date('2099-02-01T00:00:00.000Z') }),
        review({ id: 'r3', scheduledAt: new Date('2099-03-01T00:00:00.000Z') }),
      ]);
      const current = statuses.filter(
        (s) => s === JourneyMilestoneStatus.CURRENT,
      );
      expect(current.length).toBeLessThanOrEqual(1);
    });
  });

  /**
   * Client decision Q3 — readiness is recorded as a moment, it can lapse, and
   * regaining it notifies the provider again.
   */
  describe('Q3 — gateway readiness is a recorded moment', () => {
    const user = { id: 'u1', organisationId: 'org-1' } as never;

    beforeEach(() => {
      makeGatewayReady();
      membershipRepo.find.mockResolvedValue([{ user: { id: 'admin-1' } }]);
    });

    it('records the moment and notifies the provider on first readiness', async () => {
      const enrolment = buildEnrolment();
      enrolmentsService.findOne.mockResolvedValue(enrolment);

      const journey = await service.getJourney(user, 'enr-1');

      expect(journey.gatewayReady).toBe(true);
      expect(enrolment.gatewayReadyAt).toBeInstanceOf(Date);
      expect(journey.gatewayReadyAt).toBe(enrolment.gatewayReadyAt);
      expect(notifications.createForUser).toHaveBeenCalledTimes(1);
    });

    it('does not re-notify while readiness is unbroken', async () => {
      const enrolment = buildEnrolment({
        gatewayReadyAt: new Date('2026-01-01T00:00:00.000Z'),
        gatewayReadyNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      enrolmentsService.findOne.mockResolvedValue(enrolment);

      await service.getJourney(user, 'enr-1');

      expect(notifications.createForUser).not.toHaveBeenCalled();
      expect(enrolment.gatewayReadyAt).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
    });

    /**
     * Q3a — the badge reflects the current position, so a withdrawn criterion
     * clears the recorded moment rather than leaving a high-water mark.
     */
    it('clears the recorded moment when readiness lapses', async () => {
      commitmentGroupRepo.findOne.mockResolvedValue(null);
      const enrolment = buildEnrolment({
        gatewayReadyAt: new Date('2026-01-01T00:00:00.000Z'),
        gatewayReadyNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      enrolmentsService.findOne.mockResolvedValue(enrolment);

      const journey = await service.getJourney(user, 'enr-1');

      expect(journey.gatewayReady).toBe(false);
      expect(enrolment.gatewayReadyAt).toBeNull();
      expect(journey.gatewayReadyAt).toBeNull();
    });

    /**
     * Q3b — if the first notification led to nothing because readiness
     * lapsed, only a second notification reopens it.
     */
    it('notifies again when readiness is regained after a lapse', async () => {
      commitmentGroupRepo.findOne.mockResolvedValue(null);
      const enrolment = buildEnrolment({
        gatewayReadyAt: new Date('2026-01-01T00:00:00.000Z'),
        gatewayReadyNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      enrolmentsService.findOne.mockResolvedValue(enrolment);

      await service.getJourney(user, 'enr-1');
      expect(enrolment.gatewayReadyNotifiedAt).toBeNull();

      makeGatewayReady();
      await service.getJourney(user, 'enr-1');

      expect(enrolment.gatewayReadyAt).toBeInstanceOf(Date);
      expect(notifications.createForUser).toHaveBeenCalledTimes(1);
    });

    /**
     * The reason readiness and notification are two columns: a dispatch that
     * throws must not leave readiness unrecorded, and must be retried.
     */
    it('retries the notification when the first dispatch failed', async () => {
      const enrolment = buildEnrolment({
        gatewayReadyAt: new Date('2026-01-01T00:00:00.000Z'),
        gatewayReadyNotifiedAt: null,
      });
      enrolmentsService.findOne.mockResolvedValue(enrolment);

      await service.getJourney(user, 'enr-1');

      expect(notifications.createForUser).toHaveBeenCalledTimes(1);
      expect(enrolment.gatewayReadyNotifiedAt).toBeInstanceOf(Date);
    });
  });
});
