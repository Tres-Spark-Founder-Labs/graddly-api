import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { WithdrawalCompletionPush } from './entities/withdrawal-completion-push.entity.js';
import { WithdrawalPushStatus } from './enums/withdrawal-push-status.enum.js';
import { WithdrawalPushDispatchService } from './withdrawal-push-dispatch.service.js';
import { WithdrawalPushService } from './withdrawal-push.service.js';

describe('WithdrawalPushService', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
  };
  const dispatch = { enqueue: jest.fn() };
  let service: WithdrawalPushService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WithdrawalPushService,
        {
          provide: getRepositoryToken(WithdrawalCompletionPush),
          useValue: repo,
        },
        {
          provide: WithdrawalPushDispatchService,
          useValue: dispatch,
        },
      ],
    }).compile();
    service = moduleRef.get(WithdrawalPushService);
    jest.clearAllMocks();
  });

  it('queues push record and dispatches job', async () => {
    repo.create.mockImplementation((input: unknown) => input);
    repo.save.mockResolvedValue({
      id: 'push-1',
      organisationId: 'org-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
      status: WithdrawalPushStatus.QUEUED,
    });

    await service.queueFromEnrolment({
      organisationId: 'org-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
      requestedByUserId: 'usr-1',
    });

    expect(dispatch.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ pushId: 'push-1', organisationId: 'org-1' }),
    );
  });

  it('queues push from apprentice withdrawal', async () => {
    repo.create.mockImplementation((input: unknown) => input);
    repo.save.mockResolvedValue({
      id: 'push-2',
      organisationId: 'org-1',
      apprenticeId: 'app-1',
      status: WithdrawalPushStatus.QUEUED,
    });

    await service.queueFromApprenticeWithdrawal({
      organisationId: 'org-1',
      apprenticeId: 'app-1',
      requestedByUserId: 'usr-1',
    });

    expect(dispatch.enqueue).toHaveBeenCalled();
  });

  it('lists failed pushes', async () => {
    repo.findAndCount.mockResolvedValue([
      [{ id: 'push-1', status: WithdrawalPushStatus.FAILED }],
      1,
    ]);

    const result = await service.listFailed(
      { id: 'u1', organisationId: 'org-1' } as never,
      { page: 1, perPage: 20 },
    );

    expect(result.items).toHaveLength(1);
  });

  it('returns push by id', async () => {
    repo.findOne.mockResolvedValue({
      id: 'push-1',
      organisationId: 'org-1',
      status: WithdrawalPushStatus.FAILED,
    });

    const result = await service.getOne(
      { id: 'u1', organisationId: 'org-1' } as never,
      'push-1',
    );

    expect(result.id).toBe('push-1');
  });

  it('throws when retry target is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.retryFailed({ id: 'u1', organisationId: 'org-1' } as never, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
