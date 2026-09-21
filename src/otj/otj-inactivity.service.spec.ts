import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import {
  OTJ_INACTIVITY_CTA_PATH,
  OtjInactivityService,
} from './otj-inactivity.service.js';

/**
 * F3.1.4 AC4 — "Push notification sent if the apprentice has not logged any
 * OTJ in the last 7 days." The rules that decide who is alerted and how often.
 */
describe('OtjInactivityService', () => {
  const enrolmentRepo = { find: jest.fn(), update: jest.fn() };
  const otjRepo = { count: jest.fn() };
  const notifications = { createForUser: jest.fn(), sendPush: jest.fn() };

  let service: OtjInactivityService;

  const NOW = new Date('2026-09-21T09:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

  const enrolment = (overrides: Partial<Enrolment> = {}) =>
    ({
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.ACTIVE,
      apprenticeUserId: 'user-app',
      activatedAt: daysAgo(60),
      otjInactivityAlertedAt: null,
      ...overrides,
    }) as Enrolment;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjInactivityService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(OtjInactivityService);
    jest.clearAllMocks();
    enrolmentRepo.update.mockResolvedValue(undefined);
    notifications.createForUser.mockResolvedValue({ id: 'n-1' });
    notifications.sendPush.mockResolvedValue({
      outcome: 'sent',
      delivery: { delivered: 1, expired: 0, failed: 0 },
    });
  });

  it('alerts an apprentice with no entry logged in the last seven days, in-app and by push, with the CTA', async () => {
    enrolmentRepo.find.mockResolvedValue([enrolment()]);
    otjRepo.count.mockResolvedValue(0);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({
      checked: 1,
      inactive: 1,
      alerted: 1,
      alreadyAlerted: 0,
      pushed: 1,
    });
    expect(notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-app',
        organisationId: 'org-1',
        type: NotificationType.OTJ,
      }),
    );
    const [inApp] = notifications.createForUser.mock.calls[0] as [
      { metadata: Record<string, unknown> },
    ];
    expect(inApp.metadata).toMatchObject({
      enrolmentId: 'enr-1',
      action: 'log_otj',
      ctaPath: OTJ_INACTIVITY_CTA_PATH,
    });
    const [push] = notifications.sendPush.mock.calls[0] as [
      { userId: string; type: NotificationType; payload: { url: string } },
    ];
    expect(push).toMatchObject({
      userId: 'user-app',
      type: NotificationType.OTJ,
    });
    expect(push.payload.url).toBe(OTJ_INACTIVITY_CTA_PATH);
    expect(enrolmentRepo.update).toHaveBeenCalledWith('enr-1', {
      otjInactivityAlertedAt: NOW,
    });
  });

  it('counts an entry created in the window as logging, whatever date it is for', async () => {
    enrolmentRepo.find.mockResolvedValue([enrolment()]);
    otjRepo.count.mockResolvedValue(1);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ checked: 1, inactive: 0, alerted: 0 });
    expect(notifications.createForUser).not.toHaveBeenCalled();
    const [options] = otjRepo.count.mock.calls[0] as [
      { where: { createdAt: { value: Date } } },
    ];
    expect(options.where.createdAt.value).toEqual(daysAgo(7));
  });

  /**
   * AC6 — "recur each week until pace is restored": once per apprentice per
   * week, not once per daily run.
   */
  it('does not alert again within seven days of the last alert', async () => {
    enrolmentRepo.find.mockResolvedValue([
      enrolment({ otjInactivityAlertedAt: daysAgo(3) }),
    ]);
    otjRepo.count.mockResolvedValue(0);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({
      inactive: 1,
      alerted: 0,
      alreadyAlerted: 1,
    });
    expect(notifications.createForUser).not.toHaveBeenCalled();
  });

  it('alerts again once a full week has passed since the last alert', async () => {
    enrolmentRepo.find.mockResolvedValue([
      enrolment({ otjInactivityAlertedAt: daysAgo(8) }),
    ]);
    otjRepo.count.mockResolvedValue(0);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ alerted: 1, alreadyAlerted: 0 });
  });

  it('alerts a person on two active enrolments once, and reads both for entries', async () => {
    enrolmentRepo.find.mockResolvedValue([
      enrolment({ id: 'enr-new', activatedAt: daysAgo(10) }),
      enrolment({ id: 'enr-old', activatedAt: daysAgo(400) }),
    ]);
    otjRepo.count.mockResolvedValue(0);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ checked: 1, alerted: 1 });
    expect(notifications.createForUser).toHaveBeenCalledTimes(1);
    const [options] = otjRepo.count.mock.calls[0] as [
      { where: { enrolmentId: { value: string[] } } },
    ];
    expect(options.where.enrolmentId.value).toEqual(['enr-new', 'enr-old']);
    // The most recently activated enrolment carries the alert and the stamp.
    expect(enrolmentRepo.update).toHaveBeenCalledWith('enr-new', {
      otjInactivityAlertedAt: NOW,
    });
  });

  it('has nobody to alert on an enrolment with no apprentice account yet', async () => {
    enrolmentRepo.find.mockResolvedValue([
      enrolment({ apprenticeUserId: null }),
    ]);

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ checked: 0, alerted: 0 });
    expect(otjRepo.count).not.toHaveBeenCalled();
  });

  it('stamps the alert on the in-app notice, whether or not a browser was pushed', async () => {
    enrolmentRepo.find.mockResolvedValue([enrolment()]);
    otjRepo.count.mockResolvedValue(0);
    notifications.sendPush.mockResolvedValue({
      outcome: 'no_subscription',
      delivery: { delivered: 0, expired: 0, failed: 0 },
    });

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ alerted: 1, pushed: 0 });
    expect(enrolmentRepo.update).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one apprentice cannot be alerted', async () => {
    enrolmentRepo.find.mockResolvedValue([
      enrolment({ id: 'enr-a', apprenticeUserId: 'user-a' }),
      enrolment({ id: 'enr-b', apprenticeUserId: 'user-b' }),
    ]);
    otjRepo.count.mockResolvedValue(0);
    notifications.createForUser
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ id: 'n-2' });

    const result = await service.alertInactiveApprentices(NOW);

    expect(result).toMatchObject({ checked: 2, inactive: 2, alerted: 1 });
  });
});
