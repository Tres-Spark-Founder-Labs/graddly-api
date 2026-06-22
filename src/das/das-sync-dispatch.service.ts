import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { v4 as uuidV4 } from 'uuid';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_DAS_SYNC } from '../bullmq/bullmq.constants.js';

import {
  DAS_JOB_SYNC_FUNDING_PAYMENTS,
  DAS_JOB_SYNC_ORGANISATION,
} from './das-job.constants.js';

import type { IDasSyncJobPayload } from './das-job.payload.js';

@Injectable()
export class DasSyncDispatchService {
  constructor(
    @InjectQueue(QUEUE_DAS_SYNC) private readonly dasSyncQueue: Queue,
  ) {}

  async enqueueSync(input: IDasSyncJobPayload): Promise<{ jobId: string }> {
    const jobId = uuidV4();
    await this.dasSyncQueue.add(DAS_JOB_SYNC_ORGANISATION, input, {
      ...bullmqDefaultJobOptions,
      jobId,
    });
    return { jobId };
  }

  async enqueueFundingSync(
    input: IDasSyncJobPayload,
  ): Promise<{ jobId: string }> {
    const jobId = uuidV4();
    await this.dasSyncQueue.add(DAS_JOB_SYNC_FUNDING_PAYMENTS, input, {
      ...bullmqDefaultJobOptions,
      jobId,
    });
    return { jobId };
  }
}
