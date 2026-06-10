import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { QUEUE_ILR_SUBMIT_DLQ } from '../../src/bullmq/bullmq.constants.js';
import { IlrSubmission } from '../../src/ilr/entities/ilr-submission.entity.js';
import { IlrEnrolmentContext } from '../../src/ilr/ilr-enrolment.context.js';
import { IlrLearnerRecordsService } from '../../src/ilr/ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from '../../src/ilr/ilr-payload-serializer.service.js';
import { ILR_SUBMIT_JOB_PROCESS } from '../../src/ilr/ilr-submit.constants.js';
import { IlrSubmitProcessor } from '../../src/ilr/ilr-submit.processor.js';
import { ILR_ESFA_CLIENT } from '../../src/ilr/ilr.constants.js';
import { NotificationsService } from '../../src/notifications/notifications.service.js';

import type { IIlrSubmitJobPayload } from '../../src/ilr/ilr-submit.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';

export async function processIlrSubmitJobInApp(
  app: INestApplication,
  payload: IIlrSubmitJobPayload,
  options: { attemptsMade?: number } = {},
): Promise<void> {
  const processor = new IlrSubmitProcessor(
    app.get<Repository<IlrSubmission>>(getRepositoryToken(IlrSubmission)),
    app.get(ILR_ESFA_CLIENT),
    app.get(IlrLearnerRecordsService),
    app.get(IlrEnrolmentContext),
    app.get(IlrPayloadSerializerService),
    app.get(NotificationsService),
    app.get(getQueueToken(QUEUE_ILR_SUBMIT_DLQ)),
  );

  const job = {
    id: payload.submissionId,
    name: ILR_SUBMIT_JOB_PROCESS,
    data: payload,
    opts: { attempts: 3 },
    attemptsMade: options.attemptsMade ?? 0,
  } as Job<IIlrSubmitJobPayload>;

  await processor.process(job);
}
