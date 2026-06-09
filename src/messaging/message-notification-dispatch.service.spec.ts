import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { QUEUE_EMAIL } from '../bullmq/bullmq.constants.js';
import { EmailPayloadFactory } from '../email/email-payload.factory.js';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { MessageThread } from './entities/message-thread.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessageNotificationDispatchService } from './message-notification-dispatch.service.js';
import { MESSAGE_EMAIL_DEBOUNCE_MS } from './messaging.constants.js';

describe('MessageNotificationDispatchService', () => {
  const emailQueue = { add: jest.fn() };
  const notificationsService = { createForUser: jest.fn() };
  const preferenceRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const emailPayloadFactory = {
    toJob: jest.fn().mockReturnValue({ template: 'x' }),
  };

  let service: MessageNotificationDispatchService;

  const thread = {
    id: 't-1',
    organisationId: 'org-1',
    enrolmentId: 'e-1',
    apprenticeUserId: 'u-app',
    counterpartyUserId: 'u-tutor',
    counterpartyParty: MessageThreadParty.TUTOR,
  } as MessageThread;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageNotificationDispatchService,
        { provide: getQueueToken(QUEUE_EMAIL), useValue: emailQueue },
        { provide: EmailPayloadFactory, useValue: emailPayloadFactory },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferenceRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(MessageNotificationDispatchService);
    jest.clearAllMocks();
    preferenceRepo.findOne.mockResolvedValue({ enabled: true });
    userRepo.findOne.mockResolvedValue({
      id: 'u-tutor',
      email: 'tutor@example.com',
      firstName: 'Tutor',
    });
  });

  it('creates in-app notification and debounced email for recipient', async () => {
    await service.notifyNewMessage({
      thread,
      messageId: 'm-1',
      senderUserId: 'u-app',
      bodyPreview: 'Hello tutor',
    });

    expect(notificationsService.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-tutor',
        type: NotificationType.MESSAGE,
      }),
    );
    expect(emailQueue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        jobId: 'msg-email:t-1:u-tutor',
        delay: MESSAGE_EMAIL_DEBOUNCE_MS,
      }),
    );
  });

  it('skips email when preference disabled', async () => {
    preferenceRepo.findOne.mockResolvedValue({ enabled: false });

    await service.notifyNewMessage({
      thread,
      messageId: 'm-1',
      senderUserId: 'u-app',
      bodyPreview: 'Hello tutor',
    });

    expect(notificationsService.createForUser).toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });
});
