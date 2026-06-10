import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_ENROLMENT_PUSH } from '../bullmq/bullmq.constants.js';

import { ENROLMENT_PUSH_JOB_SEND } from './enrolment-push.constants.js';

import type { IEnrolmentPushJobPayload } from './enrolment-push.payload.js';

@Injectable()
export class EnrolmentPushDispatchService {
  constructor(
    @InjectQueue(QUEUE_ENROLMENT_PUSH)
    private readonly queue: Queue,
  ) {}

  async enqueue(payload: IEnrolmentPushJobPayload): Promise<void> {
    await this.queue.add(ENROLMENT_PUSH_JOB_SEND, payload, {
      ...bullmqDefaultJobOptions,
      jobId: payload.pushId,
    });
  }
}
