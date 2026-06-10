import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { QUEUE_ILR_SUBMIT_DLQ } from '../bullmq/bullmq.constants.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrSubmissionStatus } from './enums/ilr-submission-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { ILR_SUBMIT_JOB_PROCESS } from './ilr-submit.constants.js';
import { IIlrSubmitJobPayload } from './ilr-submit.payload.js';
import { IlrSubmitProcessor } from './ilr-submit.processor.js';
import { ILR_ESFA_CLIENT } from './ilr.constants.js';
import {
  buildLearnerRecordFixture,
  buildSampleFieldMap,
} from './testing/ilr-test-fixtures.js';

describe('IlrSubmitProcessor', () => {
  let processor: IlrSubmitProcessor;
  const esfaClient = { submit: jest.fn() };
  const dlqQueue = { add: jest.fn() };
  const notifications = { createForUser: jest.fn() };

  const submission = {
    id: 'sub-1',
    organisationId: 'org-1',
    ilrLearnerRecordId: 'record-1',
    attempt: 1,
    isAmendment: false,
    amendsSubmissionId: null,
    status: IlrSubmissionStatus.QUEUED,
    requestPayload: {},
    requestedByUserId: 'user-1',
    esfaReference: null,
    receipt: null,
    submittedAt: null,
    failedAt: null,
    lastError: null,
    isDeleted: false,
  };

  const submissionRepo = {
    findOne: jest.fn(),
    save: jest.fn((row: IlrSubmission) => Promise.resolve(row)),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrSubmitProcessor,
        IlrPayloadSerializerService,
        {
          provide: getRepositoryToken(IlrSubmission),
          useValue: submissionRepo,
        },
        { provide: ILR_ESFA_CLIENT, useValue: esfaClient },
        {
          provide: IlrLearnerRecordsService,
          useValue: {
            requireRecordEntity: jest.fn().mockResolvedValue(
              buildLearnerRecordFixture({
                id: 'record-1',
                status: IlrLearnerRecordStatus.VALIDATED,
                fields: buildSampleFieldMap(),
              }),
            ),
          },
        },
        {
          provide: IlrEnrolmentContext,
          useValue: {
            requireEnrolmentGraph: jest.fn().mockResolvedValue({
              organisation: { ukprn: '10012345' },
            }),
          },
        },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: getQueueToken(QUEUE_ILR_SUBMIT_DLQ),
          useValue: dlqQueue,
        },
      ],
    }).compile();

    processor = moduleRef.get(IlrSubmitProcessor);
    jest.clearAllMocks();
    submissionRepo.findOne.mockResolvedValue({ ...submission });
    esfaClient.submit.mockResolvedValue({
      esfaReference: 'ESFA-1',
      receipt: { status: 'accepted' },
    });
  });

  const job = {
    id: 'job-1',
    name: ILR_SUBMIT_JOB_PROCESS,
    data: {
      submissionId: 'sub-1',
      organisationId: 'org-1',
      requestedByUserId: 'user-1',
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as Job<IIlrSubmitJobPayload>;

  it('submits to ESFA and marks submission submitted', async () => {
    await processor.process(job);

    expect(esfaClient.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        xmlPayload: expect.stringContaining('<Message>') as string,
      }),
    );
    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: IlrSubmissionStatus.SUBMITTED,
        esfaReference: 'ESFA-1',
      }),
    );
    expect(notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.ILR_SUBMISSION_SUCCEEDED,
      }),
    );
  });

  it('skips already submitted rows', async () => {
    submissionRepo.findOne.mockResolvedValue({
      ...submission,
      status: IlrSubmissionStatus.SUBMITTED,
    });

    await processor.process(job);
    expect(esfaClient.submit).not.toHaveBeenCalled();
  });

  it('enqueues DLQ on terminal failure', async () => {
    esfaClient.submit.mockRejectedValue(new Error('ESFA down'));
    const terminalJob = {
      ...job,
      attemptsMade: 2,
    } as unknown as Job<IIlrSubmitJobPayload>;

    await expect(processor.process(terminalJob)).rejects.toThrow('ESFA down');

    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: IlrSubmissionStatus.FAILED,
        lastError: 'ESFA down',
      }),
    );
    expect(dlqQueue.add).toHaveBeenCalled();
    expect(notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.ILR_SUBMISSION_FAILED,
      }),
    );
  });
});
