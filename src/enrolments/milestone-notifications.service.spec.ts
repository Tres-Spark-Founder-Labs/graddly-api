import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentMilestoneNotification } from './entities/enrolment-milestone-notification.entity.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';
import { JourneyMilestoneStatus } from './enums/journey-milestone-status.enum.js';
import { MilestoneNotificationOutcome } from './enums/milestone-notification-outcome.enum.js';
import { MilestoneNotificationsService } from './milestone-notifications.service.js';

/**
 * F3.4.3 AC2 — `milestone_completed`. The rules that decide what is
 * announced, what is recorded silently, and what is left for the next sweep.
 */
describe('MilestoneNotificationsService', () => {
  const enrolmentRepo = { find: jest.fn(), save: jest.fn() };
  const execute = jest.fn();
  const insertValues = jest.fn();
  const markerRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const journey = { milestonesForNotification: jest.fn() };
  const notifications = { createForUser: jest.fn(), sendEmail: jest.fn() };

  let service: MilestoneNotificationsService;

  const NOW = new Date('2026-09-23T06:00:00.000Z');
  const FIRST_SEEN = new Date('2026-08-01T06:00:00.000Z');

  const enrolment = (overrides: Partial<Enrolment> = {}) =>
    ({
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.ACTIVE,
      apprenticeUserId: 'user-app',
      milestonesObservedAt: FIRST_SEEN,
      ...overrides,
    }) as Enrolment;

  const milestone = (
    notificationKey: string,
    status: JourneyMilestoneStatus = JourneyMilestoneStatus.COMPLETE,
    date: string | null = '2026-09-20',
  ) => ({
    code: notificationKey.startsWith('review:') ? 'review_1' : notificationKey,
    title: notificationKey === 'gateway' ? 'Gateway' : 'Review 1',
    date,
    status,
    notificationKey,
  });

  /** The values handed to the marker insert, in call order. */
  const recorded = () =>
    insertValues.mock.calls.map(
      ([values]) => values as Record<string, unknown>,
    );

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MilestoneNotificationsService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(EnrolmentMilestoneNotification),
          useValue: markerRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: EnrolmentJourneyService, useValue: journey },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Graddly') },
        },
      ],
    }).compile();
    service = moduleRef.get(MilestoneNotificationsService);

    jest.clearAllMocks();
    enrolmentRepo.save.mockResolvedValue(undefined);
    markerRepo.find.mockResolvedValue([]);
    execute.mockResolvedValue({ identifiers: [] });
    insertValues.mockReturnValue({ orIgnore: () => ({ execute }) });
    markerRepo.createQueryBuilder.mockReturnValue({
      insert: () => ({ values: insertValues }),
    });
    userRepo.findOne.mockResolvedValue({
      id: 'user-app',
      email: 'learner@example.com',
      firstName: 'Ada',
    });
    notifications.createForUser.mockResolvedValue({ id: 'notif-1' });
    notifications.sendEmail.mockResolvedValue('queued');
  });

  describe('the first sweep of an enrolment', () => {
    it('records what is already complete without announcing any of it', async () => {
      enrolmentRepo.find.mockResolvedValue([
        enrolment({ milestonesObservedAt: null }),
      ]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('enrolment'),
        milestone('gateway'),
        milestone('review:rev-1'),
        milestone('completion', JourneyMilestoneStatus.UPCOMING),
      ]);

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({
        enrolmentsChecked: 1,
        seeded: 3,
        notified: 0,
        unreached: 0,
      });
      expect(notifications.createForUser).not.toHaveBeenCalled();
      expect(notifications.sendEmail).not.toHaveBeenCalled();
      // Only the complete ones are accounted for; the upcoming one stays open.
      expect(recorded().map((row) => row.milestoneKey)).toEqual([
        'enrolment',
        'gateway',
        'review:rev-1',
      ]);
      for (const row of recorded()) {
        expect(row.outcome).toBe(MilestoneNotificationOutcome.SEEDED);
        expect(row.notifiedAt).toBeNull();
        expect(row.reason).toContain(
          'before the milestone sweep first observed',
        );
      }
    });

    it('stamps the enrolment, so the next sweep is not a first sweep', async () => {
      enrolmentRepo.find.mockResolvedValue([
        enrolment({ milestonesObservedAt: null }),
      ]);
      journey.milestonesForNotification.mockResolvedValue([]);

      await service.notifyCompletedMilestones(NOW);

      const [saved] = enrolmentRepo.save.mock.calls[0] as [Enrolment];
      expect(saved.milestonesObservedAt).toEqual(NOW);
    });
  });

  describe('a milestone completed after the first sweep', () => {
    it('announces it once, in app and by email, and records the delivery', async () => {
      enrolmentRepo.find.mockResolvedValue([enrolment()]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('review:rev-1'),
      ]);

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ notified: 1, seeded: 0, unreached: 0 });
      expect(notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-app',
          organisationId: 'org-1',
          type: NotificationType.MILESTONE_COMPLETED,
        }),
      );
      const [inApp] = notifications.createForUser.mock.calls[0] as [
        { metadata: Record<string, unknown> },
      ];
      expect(inApp.metadata).toMatchObject({
        enrolmentId: 'enr-1',
        milestoneKey: 'review:rev-1',
      });
      const [email] = notifications.sendEmail.mock.calls[0] as [
        {
          type: NotificationType;
          payload: {
            template: string;
            to: string;
            getTemplateContext: () => Record<string, unknown>;
          };
        },
      ];
      expect(email.type).toBe(NotificationType.MILESTONE_COMPLETED);
      expect(email.payload.template).toBe('milestone-completed');
      expect(email.payload.to).toBe('learner@example.com');
      // The timeline's own date, never a review row's mutable `updatedAt`.
      expect(email.payload.getTemplateContext()).toMatchObject({
        firstName: 'Ada',
        milestoneTitle: 'Review 1',
        milestoneDate: '2026-09-20',
      });
      expect(recorded()).toEqual([
        expect.objectContaining({
          milestoneKey: 'review:rev-1',
          outcome: MilestoneNotificationOutcome.NOTIFIED,
          notifiedAt: NOW,
          completedOn: '2026-09-20',
          reason: null,
        }),
      ]);
    });

    it('says nothing on the next sweep, because the marker accounts for it', async () => {
      enrolmentRepo.find.mockResolvedValue([enrolment()]);
      markerRepo.find.mockResolvedValue([
        { id: 'm-1', milestoneKey: 'review:rev-1' },
      ]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('review:rev-1'),
      ]);

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ notified: 0, seeded: 0, unreached: 0 });
      expect(notifications.createForUser).not.toHaveBeenCalled();
      expect(insertValues).not.toHaveBeenCalled();
    });

    /**
     * The decision recorded on the service: a marker is permanent, so a
     * review rescheduled after completion and completed again is not
     * announced twice. Deliberately unlike gateway readiness, which clears.
     */
    it('never re-announces a milestone that regressed and completed again', async () => {
      enrolmentRepo.find.mockResolvedValue([enrolment()]);
      markerRepo.find.mockResolvedValue([
        { id: 'm-1', milestoneKey: 'review:rev-1' },
      ]);
      journey.milestonesForNotification
        .mockResolvedValueOnce([
          milestone('review:rev-1', JourneyMilestoneStatus.UPCOMING),
        ])
        .mockResolvedValueOnce([milestone('review:rev-1')]);

      await service.notifyCompletedMilestones(NOW);
      await service.notifyCompletedMilestones(NOW);

      expect(notifications.createForUser).not.toHaveBeenCalled();
      expect(insertValues).not.toHaveBeenCalled();
    });
  });

  describe('milestones that are recorded but never announced', () => {
    it.each(['enrolment', 'induction'])(
      'seeds %s with the reason on the row rather than notifying',
      async (key) => {
        enrolmentRepo.find.mockResolvedValue([enrolment()]);
        journey.milestonesForNotification.mockResolvedValue([milestone(key)]);

        const result = await service.notifyCompletedMilestones(NOW);

        expect(result).toMatchObject({ seeded: 1, notified: 0 });
        expect(notifications.createForUser).not.toHaveBeenCalled();
        expect(recorded()).toHaveLength(1);
        const [row] = recorded();
        expect(row).toMatchObject({
          milestoneKey: key,
          outcome: MilestoneNotificationOutcome.SEEDED,
          notifiedAt: null,
        });
        // The reason stays on the row, so the silence is explainable later.
        expect(row.reason).toContain('deliberately not announced');
      },
    );
  });

  describe('when nothing landed', () => {
    /**
     * The fault this shape exists to avoid: a marker written as a claim
     * suppresses every later attempt, so a send that reached nobody becomes
     * permanent silence.
     */
    it('writes no marker when the apprentice has no portal account, and retries next sweep', async () => {
      enrolmentRepo.find.mockResolvedValue([
        enrolment({ apprenticeUserId: null }),
      ]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('gateway'),
      ]);

      const first = await service.notifyCompletedMilestones(NOW);
      const second = await service.notifyCompletedMilestones(NOW);

      expect(first).toMatchObject({ notified: 0, unreached: 1 });
      expect(second).toMatchObject({ notified: 0, unreached: 1 });
      expect(insertValues).not.toHaveBeenCalled();
    });

    it('writes no marker when the recipient holds no membership and the email is switched off', async () => {
      enrolmentRepo.find.mockResolvedValue([enrolment()]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('gateway'),
      ]);
      // F1.2.5 AC3/AC5 — invited, not yet a member: `createForUser` is null.
      notifications.createForUser.mockResolvedValue(null);
      // F3.4.3 AC3 — the learner has switched this type off.
      notifications.sendEmail.mockResolvedValue('suppressed');

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ notified: 0, unreached: 1 });
      expect(insertValues).not.toHaveBeenCalled();
    });

    it('counts the in-app row alone as a delivery when the email is switched off', async () => {
      enrolmentRepo.find.mockResolvedValue([enrolment()]);
      journey.milestonesForNotification.mockResolvedValue([
        milestone('gateway'),
      ]);
      notifications.sendEmail.mockResolvedValue('suppressed');

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ notified: 1, unreached: 0 });
      expect(recorded()).toEqual([
        expect.objectContaining({
          outcome: MilestoneNotificationOutcome.NOTIFIED,
          notifiedAt: NOW,
        }),
      ]);
    });

    it('keeps sweeping the rest of the estate when one enrolment throws', async () => {
      enrolmentRepo.find.mockResolvedValue([
        enrolment({ id: 'enr-bad' }),
        enrolment({ id: 'enr-good' }),
      ]);
      journey.milestonesForNotification
        .mockRejectedValueOnce(new Error('journey unavailable'))
        .mockResolvedValueOnce([milestone('gateway')]);

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ enrolmentsChecked: 1, notified: 1 });
    });
  });

  describe('the completed estate', () => {
    it('stops recomputing a finished programme once its completion is accounted for', async () => {
      enrolmentRepo.find.mockResolvedValue([
        enrolment({ status: EnrolmentStatus.COMPLETED }),
      ]);
      markerRepo.find.mockResolvedValue([
        { id: 'm-1', milestoneKey: 'completion' },
      ]);

      const result = await service.notifyCompletedMilestones(NOW);

      expect(result).toMatchObject({ enrolmentsChecked: 1, notified: 0 });
      expect(journey.milestonesForNotification).not.toHaveBeenCalled();
    });
  });
});
