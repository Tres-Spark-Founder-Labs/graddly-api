import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { QUEUE_ENROLMENT_PUSH_DLQ } from '../../src/bullmq/bullmq.constants.js';
import { DasHttpClient } from '../../src/das/das-http.client.js';
import { ENROLMENT_PUSH_JOB_SEND } from '../../src/enrolment-push/enrolment-push.constants.js';
import { EnrolmentPushProcessor } from '../../src/enrolment-push/enrolment-push.processor.js';
import { EnrolmentSubmissionPush } from '../../src/enrolment-push/entities/enrolment-submission-push.entity.js';
import { EnrolmentPipelineService } from '../../src/enrolments/enrolment-pipeline.service.js';

import type { IEnrolmentPushJobPayload } from '../../src/enrolment-push/enrolment-push.payload.js';
import type { App } from 'supertest/types';

export async function processEnrolmentPushJobInApp(
  app: INestApplication<App>,
  payload: IEnrolmentPushJobPayload,
  options?: { attemptsMade?: number },
): Promise<void> {
  const processor = new EnrolmentPushProcessor(
    app.get(DasHttpClient),
    app.get(EnrolmentPipelineService),
    app.get<Repository<EnrolmentSubmissionPush>>(
      getRepositoryToken(EnrolmentSubmissionPush),
    ),
    app.get(getQueueToken(QUEUE_ENROLMENT_PUSH_DLQ)),
  );

  const job = {
    id: payload.pushId,
    name: ENROLMENT_PUSH_JOB_SEND,
    data: payload,
    opts: { attempts: 3 },
    attemptsMade: options?.attemptsMade ?? 0,
  } as Job<IEnrolmentPushJobPayload>;

  await processor.process(job);
}
