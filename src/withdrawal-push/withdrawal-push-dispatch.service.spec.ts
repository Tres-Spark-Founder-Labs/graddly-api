import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_WITHDRAWAL_PUSH } from '../bullmq/bullmq.constants.js';

import { WithdrawalPushDispatchService } from './withdrawal-push-dispatch.service.js';
import { WITHDRAWAL_PUSH_JOB_SEND } from './withdrawal-push.constants.js';

describe('WithdrawalPushDispatchService', () => {
  const queueAdd = jest.fn();
  let service: WithdrawalPushDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        WithdrawalPushDispatchService,
        {
          provide: getQueueToken(QUEUE_WITHDRAWAL_PUSH),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    service = moduleRef.get(WithdrawalPushDispatchService);
  });

  describe('enqueue', () => {
    it('enqueues a withdrawal push job', async () => {
      const payload = {
        pushId: 'push-1',
        organisationId: 'org-1',
        enrolmentId: 'enr-1',
      } as never;

      await service.enqueue(payload);

      expect(queueAdd).toHaveBeenCalledWith(WITHDRAWAL_PUSH_JOB_SEND, payload, {
        ...bullmqDefaultJobOptions,
        jobId: 'push-1',
      });
    });
  });
});
