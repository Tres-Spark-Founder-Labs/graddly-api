import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import { MessageThreadRead } from './entities/message-thread-read.entity.js';
import { MessageThread } from './entities/message-thread.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessageThreadsService } from './message-threads.service.js';
import { MessagingAccessService } from './messaging-access.service.js';

describe('MessageThreadsService', () => {
  const threadRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const readRepo = {
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(),
  };
  const messageRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
  };
  const enrolmentRepo = { findOne: jest.fn() };
  const userRepo = { find: jest.fn().mockResolvedValue([]) };
  const accessService = {
    canRead: jest.fn().mockReturnValue(true),
    assertCanRead: jest.fn(),
  };

  let service: MessageThreadsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageThreadsService,
        { provide: getRepositoryToken(MessageThread), useValue: threadRepo },
        { provide: getRepositoryToken(MessageThreadRead), useValue: readRepo },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: MessagingAccessService, useValue: accessService },
      ],
    }).compile();

    service = moduleRef.get(MessageThreadsService);
    jest.clearAllMocks();
    accessService.canRead.mockReturnValue(true);
    userRepo.find.mockResolvedValue([]);
  });

  const user = {
    id: 'u-app',
    organisationId: 'org-1',
    roles: ['member'],
  } as const;

  it('provisions tutor and manager threads for enrolment', async () => {
    threadRepo.findOne.mockResolvedValue(null);
    const enrolment = {
      id: 'e-1',
      organisationId: 'org-1',
      apprenticeId: 'a-1',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-mgr',
      status: EnrolmentStatus.ACTIVE,
    } as Enrolment;

    await service.ensureThreadsForEnrolment(enrolment);

    expect(threadRepo.save).toHaveBeenCalledTimes(2);
    expect(threadRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        counterpartyParty: MessageThreadParty.TUTOR,
        counterpartyUserId: 'u-tutor',
      }),
    );
  });

  it('returns unread count for accessible threads', async () => {
    threadRepo.find.mockResolvedValue([
      {
        id: 't-1',
        organisationId: 'org-1',
        apprenticeUserId: 'u-app',
        counterpartyUserId: 'u-tutor',
      },
    ]);
    readRepo.findOne.mockResolvedValue(null);
    const getCount = jest.fn().mockResolvedValue(2);
    messageRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount,
    });

    const result = await service.getUnreadCount(user);
    expect(result.unreadCount).toBe(2);
  });

  it('archives all threads for enrolment', async () => {
    const threads = [
      { id: 't-1', archivedAt: null },
      { id: 't-2', archivedAt: null },
    ];
    threadRepo.find.mockResolvedValue(threads);

    await service.archiveForEnrolment('e-1');

    expect(threadRepo.save).toHaveBeenCalledTimes(2);
    expect(threads[0].archivedAt).toBeInstanceOf(Date);
  });

  it('lists accessible threads for user', async () => {
    const getMany = jest.fn().mockResolvedValue([
      {
        id: 't-1',
        organisationId: 'org-1',
        enrolmentId: 'e-1',
        apprenticeId: 'a-1',
        apprenticeUserId: 'u-app',
        counterpartyUserId: 'u-tutor',
        counterpartyParty: MessageThreadParty.TUTOR,
        archivedAt: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);
    threadRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany,
    });
    readRepo.findOne.mockResolvedValue(null);
    messageRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });

    const result = await service.list(user, { enrolmentId: 'e-1' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t-1');
  });

  it('marks thread as read for participant', async () => {
    threadRepo.findOne.mockResolvedValue({
      id: 't-1',
      organisationId: 'org-1',
      apprenticeUserId: 'u-app',
      counterpartyUserId: 'u-tutor',
      isDeleted: false,
    });
    readRepo.findOne.mockResolvedValue(null);
    readRepo.save.mockResolvedValue(undefined);

    await service.markRead(user, 't-1');

    expect(readRepo.save).toHaveBeenCalled();
  });

  it('returns thread entity for messaging', async () => {
    const thread = {
      id: 't-1',
      organisationId: 'org-1',
      isDeleted: false,
    };
    threadRepo.findOne.mockResolvedValue(thread);

    await expect(
      service.getThreadForMessaging('org-1', 't-1'),
    ).resolves.toEqual(thread);
  });

  it('throws when thread not found', async () => {
    threadRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ─── F2.2.4 AC5 — profile thread summaries ─────────────────────────────────

  describe('listSummariesForEnrolment', () => {
    const thread = {
      id: 't-1',
      organisationId: 'org-1',
      enrolmentId: 'e-1',
      apprenticeUserId: 'u-app',
      counterpartyUserId: 'u-tutor',
      counterpartyParty: MessageThreadParty.TUTOR,
      archivedAt: null,
      isDeleted: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    };

    const stubUnread = (count: number) => {
      messageRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(count),
      });
    };

    it('resolves the counterparty name, count and last message', async () => {
      threadRepo.find.mockResolvedValue([thread]);
      userRepo.find.mockResolvedValue([
        { id: 'u-tutor', firstName: 'Ade', lastName: 'Tutor' },
      ]);
      messageRepo.findOne.mockResolvedValue({
        body: 'Can we move Thursday?',
        senderUserId: 'u-tutor',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      });
      messageRepo.count.mockResolvedValue(4);
      stubUnread(1);

      const [summary] = await service.listSummariesForEnrolment(user, 'e-1');

      expect(summary).toMatchObject({
        id: 't-1',
        counterpartyName: 'Ade Tutor',
        messageCount: 4,
        unreadCount: 1,
        lastMessageAt: '2026-06-01T10:00:00.000Z',
        lastMessagePreview: 'Can we move Thursday?',
        lastMessageSenderUserId: 'u-tutor',
      });
    });

    it('returns a thread with no messages rather than omitting it', async () => {
      threadRepo.find.mockResolvedValue([thread]);
      userRepo.find.mockResolvedValue([]);
      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.count.mockResolvedValue(0);
      stubUnread(0);

      const [summary] = await service.listSummariesForEnrolment(user, 'e-1');

      expect(summary.messageCount).toBe(0);
      expect(summary.lastMessageAt).toBeNull();
      expect(summary.lastMessagePreview).toBeNull();
      // A deleted user must not collapse the whole summary.
      expect(summary.counterpartyName).toBeNull();
    });

    /**
     * The preview has to be distinguishable from a short message, or a screen
     * renders half a sentence as if it were the whole one.
     */
    it('collapses whitespace and marks a truncated preview', async () => {
      threadRepo.find.mockResolvedValue([thread]);
      userRepo.find.mockResolvedValue([]);
      messageRepo.findOne.mockResolvedValue({
        body: `line one\n\n   line two ${'x'.repeat(200)}`,
        senderUserId: 'u-app',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      });
      messageRepo.count.mockResolvedValue(1);
      stubUnread(0);

      const [summary] = await service.listSummariesForEnrolment(user, 'e-1');

      expect(summary.lastMessagePreview).toMatch(/^line one line two x+…$/);
      expect(summary.lastMessagePreview).toHaveLength(161);
    });

    it('omits threads the requesting user cannot read', async () => {
      threadRepo.find.mockResolvedValue([thread]);
      accessService.canRead.mockReturnValue(false);

      await expect(
        service.listSummariesForEnrolment(user, 'e-1'),
      ).resolves.toEqual([]);
      // No point resolving names for threads that will not be returned.
      expect(userRepo.find).not.toHaveBeenCalled();
    });
  });
});
