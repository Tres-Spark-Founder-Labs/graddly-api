import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { QUEUE_COMPLETION_PUSH_DLQ } from '../../src/bullmq/bullmq.constants.js';
import { COMPLETION_PUSH_JOB_SEND } from '../../src/completion-push/completion-push.constants.js';
import { CompletionPushProcessor } from '../../src/completion-push/completion-push.processor.js';
import { EnrolmentCompletionPush } from '../../src/completion-push/entities/enrolment-completion-push.entity.js';
import { DasHttpClient } from '../../src/das/das-http.client.js';

import type { ICompletionPushJobPayload } from '../../src/completion-push/completion-push.payload.js';
import type { App } from 'supertest/types';

export async function processCompletionPushJobInApp(
  app: INestApplication<App>,
  payload: ICompletionPushJobPayload,
  options?: { attemptsMade?: number },
): Promise<void> {
  const processor = new CompletionPushProcessor(
    app.get(DasHttpClient),
    app.get<Repository<EnrolmentCompletionPush>>(
      getRepositoryToken(EnrolmentCompletionPush),
    ),
    app.get(getQueueToken(QUEUE_COMPLETION_PUSH_DLQ)),
  );

  const job = {
    id: payload.pushId,
    name: COMPLETION_PUSH_JOB_SEND,
    data: payload,
    opts: { attempts: 3 },
    attemptsMade: options?.attemptsMade ?? 0,
  } as Job<ICompletionPushJobPayload>;

  await processor.process(job);
}
