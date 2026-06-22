import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { OtjDigestService } from './otj-digest.service.js';

describe('OtjDigestService', () => {
  let service: OtjDigestService;

  const otjLogRepo = { find: jest.fn() };
  const userRepo = { find: jest.fn() };
  const preferencesService = { isChannelEnabled: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjDigestService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjLogRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: NotificationPreferencesService,
          useValue: preferencesService,
        },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Graddly') },
        },
      ],
    }).compile();

    service = moduleRef.get(OtjDigestService);
    jest.clearAllMocks();
    preferencesService.isChannelEnabled.mockResolvedValue(true);
  });

  it('sends digest email grouped by manager', async () => {
    otjLogRepo.find.mockResolvedValue([
      {
        status: OtjLogStatus.SUBMITTED,
        loggedDate: '2026-01-10',
        minutes: 60,
        category: 'workplace',
        activityName: 'Shadowing',
        enrolment: {
          employerManagerUserId: 'mgr-1',
          apprentice: { firstName: 'Alex', lastName: 'Apprentice' },
        },
      },
    ]);
    userRepo.find.mockResolvedValue([
      {
        id: 'mgr-1',
        firstName: 'Manager',
        email: 'mgr@example.com',
      },
    ]);

    const sent = await service.sendWeeklyDigestForOrganisation('org-1');

    expect(sent).toBe(1);
    expect(preferencesService.isChannelEnabled).toHaveBeenCalledWith(
      'mgr-1',
      NotificationType.OTJ,
      NotificationChannel.DIGEST,
    );
    expect(emailDispatchService.enqueue).toHaveBeenCalled();
  });

  it('returns zero when no pending entries', async () => {
    otjLogRepo.find.mockResolvedValue([]);
    const sent = await service.sendWeeklyDigestForOrganisation('org-1');
    expect(sent).toBe(0);
  });
});
