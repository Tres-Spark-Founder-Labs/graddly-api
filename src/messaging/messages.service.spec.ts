import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';

import { MessageAttachment } from './entities/message-attachment.entity.js';
import { MessageThread } from './entities/message-thread.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessageAttachmentsService } from './message-attachments.service.js';
import { MessageNotificationDispatchService } from './message-notification-dispatch.service.js';
import { MessageThreadsService } from './message-threads.service.js';
import { MessagesService } from './messages.service.js';
import { MessagingAccessService } from './messaging-access.service.js';

describe('MessagesService', () => {
  const messageRepo = {
    findAndCount: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) =>
      Promise.resolve({ ...(v as object), id: 'm-1', createdAt: new Date() }),
    ),
  };
  const attachmentRepo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const enrolmentRepo = { findOne: jest.fn() };
  const threadsService = {
    getThreadForMessaging: jest.fn(),
    ensureThreadsForEnrolment: jest.fn(),
  };
  const accessService = {
    assertCanRead: jest.fn(),
    assertCanWrite: jest.fn(),
  };
  const attachmentsService = {
    assertAttachmentStorageKey: jest.fn(),
    assertAttachmentMetadata: jest.fn(),
  };
  const notificationDispatch = { notifyNewMessage: jest.fn() };

  let service: MessagesService;

  const thread: MessageThread = {
    id: 't-1',
    organisationId: 'org-1',
    enrolmentId: 'e-1',
    apprenticeId: 'a-1',
    counterpartyParty: MessageThreadParty.TUTOR,
    apprenticeUserId: 'u-app',
    counterpartyUserId: 'u-tutor',
    archivedAt: null,
  } as MessageThread;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        {
          provide: getRepositoryToken(MessageAttachment),
          useValue: attachmentRepo,
        },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: MessageThreadsService, useValue: threadsService },
        { provide: MessagingAccessService, useValue: accessService },
        { provide: MessageAttachmentsService, useValue: attachmentsService },
        {
          provide: MessageNotificationDispatchService,
          useValue: notificationDispatch,
        },
      ],
    }).compile();

    service = moduleRef.get(MessagesService);
    jest.clearAllMocks();
    threadsService.getThreadForMessaging.mockResolvedValue(thread);
  });

  const user = {
    id: 'u-app',
    organisationId: 'org-1',
    roles: ['member'],
  } as const;

  it('lists paginated messages', async () => {
    messageRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'm-1',
          threadId: 't-1',
          senderUserId: 'u-app',
          body: 'Hi',
          attachments: [],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      1,
    ]);

    const result = await service.list(user, 't-1', { page: 1, perPage: 20 });
    expect(result.items).toHaveLength(1);
    expect(accessService.assertCanRead).toHaveBeenCalled();
  });

  it('creates message and notifies recipient', async () => {
    const result = await service.create(user, 't-1', { body: 'Hello 👋' });

    expect(result.body).toBe('Hello 👋');
    expect(notificationDispatch.notifyNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        thread,
        senderUserId: 'u-app',
      }),
    );
  });

  it('persists attachments when provided', async () => {
    await service.create(user, 't-1', {
      body: 'See attached',
      attachments: [
        {
          storageKey: 'orgs/org-1/learners/a-1/attachment/x/file.pdf',
          filename: 'file.pdf',
          contentType: 'application/pdf',
          contentLength: 100,
        },
      ],
    });

    expect(attachmentsService.assertAttachmentStorageKey).toHaveBeenCalled();
    expect(attachmentRepo.save).toHaveBeenCalled();
  });

  it('provisions threads for enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'e-1',
      organisationId: 'org-1',
      isDeleted: false,
    });

    await service.provisionThreadsForEnrolment('e-1');

    expect(threadsService.ensureThreadsForEnrolment).toHaveBeenCalled();
  });
});
