import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_COMPLETION_PUSH } from '../bullmq/bullmq.constants.js';

import { COMPLETION_PUSH_JOB_SEND } from './completion-push.constants.js';

import type { ICompletionPushJobPayload } from './completion-push.payload.js';

@Injectable()
export class CompletionPushDispatchService {
  constructor(
    @InjectQueue(QUEUE_COMPLETION_PUSH)
    private readonly queue: Queue,
  ) {}

  async enqueue(payload: ICompletionPushJobPayload): Promise<void> {
    await this.queue.add(COMPLETION_PUSH_JOB_SEND, payload, {
      ...bullmqDefaultJobOptions,
      jobId: payload.pushId,
    });
  }
}
