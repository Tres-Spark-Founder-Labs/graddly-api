import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_ILR_SUBMIT } from '../bullmq/bullmq.constants.js';

import { ILR_SUBMIT_JOB_PROCESS } from './ilr-submit.constants.js';

import type { IIlrSubmitJobPayload } from './ilr-submit.payload.js';

@Injectable()
export class IlrSubmitDispatchService {
  constructor(
    @InjectQueue(QUEUE_ILR_SUBMIT)
    private readonly queue: Queue,
  ) {}

  async enqueue(payload: IIlrSubmitJobPayload): Promise<void> {
    await this.queue.add(ILR_SUBMIT_JOB_PROCESS, payload, {
      ...bullmqDefaultJobOptions,
      jobId: payload.submissionId,
    });
  }
}
