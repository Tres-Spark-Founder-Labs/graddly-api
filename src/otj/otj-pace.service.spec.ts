import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import { OtjPaceService } from './otj-pace.service.js';

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
  const notifications = { createForUser: jest.fn() };

  let service: OtjPaceService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjPaceService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(OtjPaceService);
    jest.clearAllMocks();

    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    });
    otjRepo.find.mockResolvedValue([]);
    otjRepo.save.mockResolvedValue(undefined);
    enrolmentRepo.save.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );
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

    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '100' }),
    });

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
    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '7200' }),
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-07-01T00:00:00.000Z'));

    const updated = await service.flagPaceForAllActiveEnrolments();
    expect(updated).toBe(0);

    jest.useRealTimers();
  });
});
