import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { QUEUE_COMPLETION_PUSH_DLQ } from '../bullmq/bullmq.constants.js';
import { DasHttpClient } from '../das/das-http.client.js';

import { COMPLETION_PUSH_JOB_SEND } from './completion-push.constants.js';
import { CompletionPushProcessor } from './completion-push.processor.js';
import { EnrolmentCompletionPush } from './entities/enrolment-completion-push.entity.js';
import { CompletionPushStatus } from './enums/completion-push-status.enum.js';

import type { ICompletionPushJobPayload } from './completion-push.payload.js';

describe('CompletionPushProcessor', () => {
  let processor: CompletionPushProcessor;
  const dasClient = { notifyCompletion: jest.fn() };
  const dlqQueue = { add: jest.fn() };
  const push = {
    id: 'push-1',
    organisationId: 'org-1',
    status: CompletionPushStatus.QUEUED,
    attempts: 0,
    payload: {
      learnerRef: 'enr-1',
      completionDate: '2026-06-01',
      epaOutcome: 'pass',
    },
  };
  const repo = {
    findOne: jest.fn(),
    save: jest.fn((row: EnrolmentCompletionPush) => Promise.resolve(row)),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompletionPushProcessor,
        { provide: DasHttpClient, useValue: dasClient },
        {
          provide: getRepositoryToken(EnrolmentCompletionPush),
          useValue: repo,
        },
        {
          provide: getQueueToken(QUEUE_COMPLETION_PUSH_DLQ),
          useValue: dlqQueue,
        },
      ],
    }).compile();

    processor = moduleRef.get(CompletionPushProcessor);
    jest.clearAllMocks();
    repo.findOne.mockResolvedValue({ ...push });
    dasClient.notifyCompletion.mockResolvedValue({
      reference: 'DAS-CMP-1',
      status: 'accepted',
      raw: {},
    });
  });

  const job = {
    id: 'job-1',
    name: COMPLETION_PUSH_JOB_SEND,
    data: {
      pushId: 'push-1',
      organisationId: 'org-1',
      requestedByUserId: 'user-1',
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as Job<ICompletionPushJobPayload>;

  it('notifies DAS and marks push delivered', async () => {
    await processor.process(job);

    expect(dasClient.notifyCompletion).toHaveBeenCalledWith({
      learnerRef: 'enr-1',
      completionDate: '2026-06-01',
      epaOutcome: 'pass',
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CompletionPushStatus.DELIVERED,
        dasReference: 'DAS-CMP-1',
      }),
    );
  });
});
