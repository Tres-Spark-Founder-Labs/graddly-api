import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CompletionPushDispatchService } from './completion-push-dispatch.service.js';
import { CompletionPushService } from './completion-push.service.js';
import { EnrolmentCompletionPush } from './entities/enrolment-completion-push.entity.js';
import { CompletionPushStatus } from './enums/completion-push-status.enum.js';

describe('CompletionPushService', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };
  const dispatch = { enqueue: jest.fn() };
  let service: CompletionPushService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompletionPushService,
        {
          provide: getRepositoryToken(EnrolmentCompletionPush),
          useValue: repo,
        },
        {
          provide: CompletionPushDispatchService,
          useValue: dispatch,
        },
      ],
    }).compile();
    service = moduleRef.get(CompletionPushService);
    jest.clearAllMocks();
  });

  it('queues completion push on enrolment completed', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.create.mockImplementation((input: unknown) => input);
    repo.save.mockResolvedValue({
      id: 'push-1',
      organisationId: 'org-1',
      status: CompletionPushStatus.QUEUED,
    });

    await service.queueFromEnrolmentCompleted({
      organisationId: 'org-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
      learnerRef: 'enr-1',
      completionDate: '2026-06-01',
      requestedByUserId: 'user-1',
    });

    expect(dispatch.enqueue).toHaveBeenCalled();
  });

  it('throws when retry target is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.retryFailed({ id: 'u1', organisationId: 'org-1' } as never, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
