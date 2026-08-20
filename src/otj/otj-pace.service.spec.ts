import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import { OtjPaceService } from './otj-pace.service.js';
import { OtjSummaryService } from './otj-summary.service.js';

describe('OtjPaceService', () => {
  const otjRepo = {
    find: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const enrolmentRepo = {
    find: jest.fn(),
    save: jest.fn(),
  };
  const userRepo = { findOne: jest.fn() };
  const apprenticeRepo = { findOne: jest.fn() };
  const notifications = { createForUser: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };

  /**
   * The conditional-sum query `OtjSummaryService.minutesForEnrolment` runs.
   * pg returns SUM() as a string, so the mock does too — the Number() coercion
   * in the service is part of what these tests cover.
   */
  const minutesQb = (approvedMinutes: number) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({
      logged: String(approvedMinutes),
      pending: '0',
      approved: String(approvedMinutes),
      rejected: '0',
    }),
  });

  let service: OtjPaceService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjPaceService,
        /**
         * P0-A — provided for real, not stubbed.
         *
         * `OtjSummaryService` now owns the approved-minutes sum this service
         * used to compute itself, and it needs only the OTJ repository, which
         * is already mocked below. Substituting a stub here would replace the
         * arithmetic under test with an assertion that the stub returns what
         * the stub was told to return.
         */
        OtjSummaryService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Apprentice), useValue: apprenticeRepo },
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Graddly') },
        },
      ],
    }).compile();
    service = moduleRef.get(OtjPaceService);
    jest.clearAllMocks();

    // The single conditional-sum query `OtjSummaryService.minutesForEnrolment`
    // runs. Numbers arrive as strings, exactly as pg returns SUM().
    otjRepo.createQueryBuilder.mockReturnValue(minutesQb(0));
    otjRepo.find.mockResolvedValue([]);
    otjRepo.save.mockResolvedValue(undefined);
    enrolmentRepo.save.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );
    userRepo.findOne.mockResolvedValue({
      id: 'user-mgr',
      firstName: 'Sam',
      email: 'manager@example.com',
    });
    apprenticeRepo.findOne.mockResolvedValue({
      id: 'a-1',
      firstName: 'Alex',
      lastName: 'Okafor',
    });
  });

  it('evaluates EPA-based pace and notifies apprentice when at risk', async () => {
    const enrolment = {
      id: 'e1',
      organisationId: 'o1',
      status: EnrolmentStatus.ACTIVE,
      plannedDurationMonths: 12,
      plannedStartDate: '2025-01-01',
      plannedEndDate: '2026-01-01',
      activatedAt: new Date('2025-01-01T00:00:00.000Z'),
      epaDate: '2026-01-01',
      apprenticeUserId: 'user-app',
      otjPaceAlertLevel: null,
      otjPaceAlertedAt: null,
    } as Enrolment;

    otjRepo.createQueryBuilder.mockReturnValue(minutesQb(100));

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-10-01T00:00:00.000Z'));

    const notified = await service.evaluateEnrolmentPace(enrolment);

    expect(notified).toBe(true);
    expect(enrolment.otjPaceAlertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
    expect(notifications.createForUser).toHaveBeenCalled();
    const notificationCalls = notifications.createForUser.mock.calls as Array<
      [{ userId: string; metadata: { alertLevel: string } }]
    >;
    expect(notificationCalls[0]?.[0].userId).toBe('user-app');
    expect(notificationCalls[0]?.[0].metadata.alertLevel).toBe('off_track');

    jest.useRealTimers();
  });

  it('flags all active enrolments via cron entrypoint', async () => {
    enrolmentRepo.find.mockResolvedValue([
      {
        id: 'e1',
        organisationId: 'o1',
        plannedDurationMonths: 12,
        plannedStartDate: '2025-01-01',
        plannedEndDate: '2026-01-01',
        activatedAt: new Date('2025-01-01T00:00:00.000Z'),
        epaDate: '2026-01-01',
        apprenticeUserId: null,
        otjPaceAlertLevel: OtjPaceAlertLevel.ON_TRACK,
        otjPaceAlertedAt: new Date(),
      },
    ]);
    otjRepo.createQueryBuilder.mockReturnValue(minutesQb(7200));

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-07-01T00:00:00.000Z'));

    const updated = await service.flagPaceForAllActiveEnrolments();
    expect(updated).toBe(0);

    jest.useRealTimers();
  });

  /**
   * F1.2.4 AC4 — "email notification sent to line manager within 24 hours of
   * flag being set".
   *
   * Before this, the only person told was the apprentice, and only in-app. An
   * employer had no signal at all that one of their apprentices had fallen
   * behind until somebody opened the roster.
   */
  describe('line manager alert (AC4)', () => {
    const behindEnrolment = () =>
      ({
        id: 'e1',
        organisationId: 'provider-org',
        employerOrganisationId: 'employer-org',
        apprenticeId: 'a-1',
        status: EnrolmentStatus.ACTIVE,
        plannedDurationMonths: 12,
        plannedStartDate: '2025-01-01',
        plannedEndDate: '2026-01-01',
        activatedAt: new Date('2025-01-01T00:00:00.000Z'),
        epaDate: '2026-01-01',
        apprenticeUserId: 'user-app',
        employerManagerUserId: 'user-mgr',
        otjPaceAlertLevel: null,
        otjPaceAlertedAt: null,
      }) as Enrolment;

    beforeEach(() => {
      // Almost no hours logged against a year-long programme, evaluated nine
      // months in — comfortably past the 30% threshold.
      otjRepo.createQueryBuilder.mockReturnValue(minutesQb(100));
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-10-01T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('notifies the line manager as well as the apprentice', async () => {
      await service.evaluateEnrolmentPace(behindEnrolment());

      const recipients = (
        notifications.createForUser.mock.calls as Array<[{ userId: string }]>
      ).map(([payload]) => payload.userId);

      expect(recipients).toContain('user-app');
      expect(recipients).toContain('user-mgr');
    });

    it('emails the line manager', async () => {
      await service.evaluateEnrolmentPace(behindEnrolment());

      const [payload] = emailDispatchService.enqueue.mock.calls[0] as [
        { to: string; template: string },
      ];
      expect(payload.to).toBe('manager@example.com');
      expect(payload.template).toBe(EmailTemplate.OTJ_PACE_ALERT);
    });

    it('names the apprentice in the alert, not just an id', async () => {
      // A manager with fifteen apprentices cannot act on "enrolment e1".
      await service.evaluateEnrolmentPace(behindEnrolment());

      const [payload] = emailDispatchService.enqueue.mock.calls[0] as [
        { getTemplateContext: () => Record<string, unknown> },
      ];
      expect(payload.getTemplateContext().apprenticeName).toBe('Alex Okafor');
    });

    it('files the manager notification under the employer organisation', async () => {
      // The enrolment is owned by the provider; the manager belongs to the
      // employer, so filing it under the owning org would hide it from them.
      await service.evaluateEnrolmentPace(behindEnrolment());

      const managerCall = (
        notifications.createForUser.mock.calls as Array<
          [{ userId: string; organisationId: string }]
        >
      ).find(([payload]) => payload.userId === 'user-mgr');

      expect(managerCall?.[0].organisationId).toBe('employer-org');
    });

    it('still flags the enrolment when the alert fails', async () => {
      // The flag is the durable outcome; a mail outage must not undo it.
      emailDispatchService.enqueue.mockRejectedValueOnce(
        new Error('mail provider down'),
      );
      const enrolment = behindEnrolment();

      await expect(
        service.evaluateEnrolmentPace(enrolment),
      ).resolves.not.toThrow();
      expect(enrolment.otjPaceAlertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
    });

    /**
     * F1.2.4 AC4 — "Email notification sent to line manager within 24 hours of
     * flag being set." The criterion says nothing about the in-app
     * notification, and F3.4.3 Notification Centre is a separate feature.
     * Email and in-app are two channels; one failing must not silence the
     * other.
     */
    it('AC4: emails the line manager even when the in-app notification fails', async () => {
      notifications.createForUser.mockRejectedValueOnce(
        new Error('notification write failed'),
      );
      const enrolment = behindEnrolment();

      await expect(
        service.evaluateEnrolmentPace(enrolment),
      ).resolves.not.toThrow();

      expect(emailDispatchService.enqueue).toHaveBeenCalled();
    });

    it('skips quietly when no line manager is assigned', async () => {
      const enrolment = behindEnrolment();
      enrolment.employerManagerUserId = null;

      await service.evaluateEnrolmentPace(enrolment);

      expect(emailDispatchService.enqueue).not.toHaveBeenCalled();
      expect(enrolment.otjPaceAlertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
    });
  });
});
