import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BullmqJobInspectionService } from './bullmq-job-inspection.service.js';
import {
  QUEUE_DAS_SYNC,
  QUEUE_COMPLETION_PUSH,
  QUEUE_COMPLETION_PUSH_DLQ,
  QUEUE_DAS_SYNC,
  QUEUE_DAS_SYNC_DLQ,
  QUEUE_DIGEST,
  QUEUE_EMAIL,
  QUEUE_ENROLMENT_PUSH,
  QUEUE_ENROLMENT_PUSH_DLQ,
  QUEUE_EVIDENCE_PACK,
  QUEUE_ILR_SUBMIT,
  QUEUE_ILR_SUBMIT_DLQ,
  QUEUE_PDF,
  QUEUE_SYSTEM,
  QUEUE_WITHDRAWAL_PUSH,
} from './bullmq.constants.js';

import type { Job, Queue } from 'bullmq';

function createQueueMock(overrides: Partial<Queue> = {}): {
  queue: Queue;
  getFailed: jest.Mock;
  getJob: jest.Mock;
} {
  const jobCounts: Record<string, number> = {
    waiting: 1,
    active: 0,
    completed: 2,
    failed: 3,
    delayed: 0,
    prioritized: 0,
  };
  jobCounts['waiting-children'] = 0;

  const getFailed = jest.fn().mockResolvedValue([
    {
      id: '1',
      name: 'job-a',
      attemptsMade: 3,
      failedReason: 'err',
      timestamp: 1000,
      finishedOn: 2000,
      queueName: QUEUE_EMAIL,
    },
  ]);
  const getJob = jest.fn();

  const queue = {
    getJobCounts: jest.fn().mockResolvedValue(jobCounts),
    getFailedCount: jest.fn().mockResolvedValue(2),
    getFailed,
    getJob,
    ...overrides,
  } as unknown as Queue;

  return { queue, getFailed, getJob };
}

describe('BullmqJobInspectionService', () => {
  let service: BullmqJobInspectionService;
  let emailQueue: Queue;
  let getFailedMock: jest.Mock;
  let getJobMock: jest.Mock;
  let systemQueue: Queue;

  beforeEach(async () => {
    const emailMocks = createQueueMock();
    emailQueue = emailMocks.queue;
    getFailedMock = emailMocks.getFailed;
    getJobMock = emailMocks.getJob;

    systemQueue = createQueueMock({
      getJobCounts: jest.fn().mockResolvedValue({ failed: 0 }),
    }).queue;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BullmqJobInspectionService,
        { provide: getQueueToken(QUEUE_EMAIL), useValue: emailQueue },
        {
          provide: getQueueToken(QUEUE_DIGEST),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_PDF),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_DAS_SYNC),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_DAS_SYNC_DLQ),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_WITHDRAWAL_PUSH),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_EVIDENCE_PACK),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_ILR_SUBMIT),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_ILR_SUBMIT_DLQ),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_ENROLMENT_PUSH),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_ENROLMENT_PUSH_DLQ),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_COMPLETION_PUSH),
          useValue: createQueueMock().queue,
        },
        {
          provide: getQueueToken(QUEUE_COMPLETION_PUSH_DLQ),
          useValue: createQueueMock().queue,
        },
        { provide: getQueueToken(QUEUE_SYSTEM), useValue: systemQueue },
      ],
    }).compile();

    service = moduleRef.get(BullmqJobInspectionService);
  });

  describe('listQueues', () => {
    it('returns summaries for all registered queues', async () => {
      const summaries = await service.listQueues();

      expect(summaries).toHaveLength(14);
      expect(summaries.find((q) => q.name === QUEUE_EMAIL)?.counts.failed).toBe(
        3,
      );
    });
  });

  describe('listFailedJobs', () => {
    it('returns paginated failed job summaries', async () => {
      const result = await service.listFailedJobs(QUEUE_EMAIL, 1, 20);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: '1',
        name: 'job-a',
        attemptsMade: 3,
      });
      expect(result.meta).toMatchObject({
        total: 2,
        page: 1,
        perPage: 20,
      });
      expect(getFailedMock).toHaveBeenCalledWith(0, 19);
    });

    it('rejects unknown queue names', async () => {
      await expect(
        service.listFailedJobs('unknown-queue', 1, 20),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getJob', () => {
    it('returns job detail when job exists on queue', async () => {
      const job = {
        id: '99',
        name: 'job-b',
        attemptsMade: 1,
        failedReason: 'fail',
        timestamp: 1,
        data: { foo: 'bar' },
        stacktrace: ['Error: fail'],
        opts: { attempts: 3 },
        queueName: QUEUE_EMAIL,
      } as Job;
      getJobMock.mockResolvedValue(job);

      const detail = await service.getJob(QUEUE_EMAIL, '99');

      expect(detail.id).toBe('99');
      expect(detail.data).toEqual({ foo: 'bar' });
    });

    it('throws when job is missing', async () => {
      getJobMock.mockResolvedValue(undefined);

      await expect(
        service.getJob(QUEUE_EMAIL, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when job belongs to another queue', async () => {
      getJobMock.mockResolvedValue({
        id: '1',
        queueName: QUEUE_SYSTEM,
      } as Job);

      await expect(service.getJob(QUEUE_EMAIL, '1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('retryJob', () => {
    it('calls job.retry for failed jobs', async () => {
      const retry = jest.fn().mockResolvedValue(undefined);
      getJobMock.mockResolvedValue({
        id: '1',
        queueName: QUEUE_EMAIL,
        retry,
      });

      await service.retryJob(QUEUE_EMAIL, '1');

      expect(retry).toHaveBeenCalledWith('failed');
    });
  });

  describe('removeJob', () => {
    it('calls job.remove', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      getJobMock.mockResolvedValue({
        id: '1',
        queueName: QUEUE_EMAIL,
        remove,
      });

      await service.removeJob(QUEUE_EMAIL, '1');

      expect(remove).toHaveBeenCalled();
    });
  });
});
