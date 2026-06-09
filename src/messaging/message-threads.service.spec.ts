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

  it('throws when thread not found', async () => {
    threadRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
