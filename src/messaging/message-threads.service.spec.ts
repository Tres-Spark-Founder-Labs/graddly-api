import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

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
  const messageRepo = { createQueryBuilder: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };
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
        { provide: MessagingAccessService, useValue: accessService },
      ],
    }).compile();

    service = moduleRef.get(MessageThreadsService);
    jest.clearAllMocks();
    accessService.canRead.mockReturnValue(true);
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
});
