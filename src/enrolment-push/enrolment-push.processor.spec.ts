import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { QUEUE_ENROLMENT_PUSH_DLQ } from '../bullmq/bullmq.constants.js';
import { DasHttpClient } from '../das/das-http.client.js';
import { EnrolmentPipelineService } from '../enrolments/enrolment-pipeline.service.js';
import { EnrolmentPipelineState } from '../enrolments/enums/enrolment-pipeline-state.enum.js';

import { ENROLMENT_PUSH_JOB_SEND } from './enrolment-push.constants.js';
import { EnrolmentPushProcessor } from './enrolment-push.processor.js';
import { EnrolmentSubmissionPush } from './entities/enrolment-submission-push.entity.js';
import { EnrolmentPushStatus } from './enums/enrolment-push-status.enum.js';

import type { IEnrolmentPushJobPayload } from './enrolment-push.payload.js';

describe('EnrolmentPushProcessor', () => {
  let processor: EnrolmentPushProcessor;
  const dasClient = { submitEnrolment: jest.fn() };
  const pipelineService = { advanceIfAhead: jest.fn() };
  const dlqQueue = { add: jest.fn() };
  const push = {
    id: 'push-1',
    organisationId: 'org-1',
    enrolmentId: 'enr-1',
    status: EnrolmentPushStatus.QUEUED,
    attempts: 0,
    payload: {
      ukprn: '10012345',
      learnerRef: 'LRN-1',
      standardCode: 'ST0001',
      givenNames: 'Alex',
      familyName: 'Taylor',
      plannedStartDate: '2025-09-01',
      plannedEndDate: '2027-09-01',
    },
  };
  const repo = {
    findOne: jest.fn(),
    save: jest.fn((row: EnrolmentSubmissionPush) => Promise.resolve(row)),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentPushProcessor,
        { provide: DasHttpClient, useValue: dasClient },
        { provide: EnrolmentPipelineService, useValue: pipelineService },
        {
          provide: getRepositoryToken(EnrolmentSubmissionPush),
          useValue: repo,
        },
        {
          provide: getQueueToken(QUEUE_ENROLMENT_PUSH_DLQ),
          useValue: dlqQueue,
        },
      ],
    }).compile();

    processor = moduleRef.get(EnrolmentPushProcessor);
    jest.clearAllMocks();
    repo.findOne.mockResolvedValue({ ...push });
    dasClient.submitEnrolment.mockResolvedValue({
      reference: 'DAS-ENR-1',
      status: 'accepted',
      raw: {},
    });
  });

  const job = {
    id: 'job-1',
    name: ENROLMENT_PUSH_JOB_SEND,
    data: {
      pushId: 'push-1',
      organisationId: 'org-1',
      requestedByUserId: 'user-1',
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as Job<IEnrolmentPushJobPayload>;

  it('submits to DAS and marks push delivered', async () => {
    await processor.process(job);

    expect(dasClient.submitEnrolment).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EnrolmentPushStatus.DELIVERED,
        dasReference: 'DAS-ENR-1',
      }),
    );
    expect(pipelineService.advanceIfAhead).toHaveBeenCalledWith(
      'enr-1',
      EnrolmentPipelineState.DAS_CONFIRMED,
    );
  });

  it('skips already delivered rows', async () => {
    repo.findOne.mockResolvedValue({
      ...push,
      status: EnrolmentPushStatus.DELIVERED,
    });

    await processor.process(job);
    expect(dasClient.submitEnrolment).not.toHaveBeenCalled();
  });

  it('enqueues DLQ on terminal failure', async () => {
    dasClient.submitEnrolment.mockRejectedValue(new Error('DAS down'));
    const terminalJob = {
      ...job,
      attemptsMade: 2,
    } as unknown as Job<IEnrolmentPushJobPayload>;

    await expect(processor.process(terminalJob)).rejects.toThrow('DAS down');
    expect(dlqQueue.add).toHaveBeenCalled();
  });
});
