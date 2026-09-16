import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { runWithTenantContext } from '../../common/context/correlation-id-context.js';
import { QUEUE_SYSTEM, SYSTEM_JOB_PING } from '../bullmq.constants.js';

@Processor(QUEUE_SYSTEM)
export class SystemPingProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemPingProcessor.name);

  /**
   * The job runs inside its own tenant store — what CorrelationIdMiddleware
   * gives a request. The values used to be set on a process-global fallback,
   * so two jobs interleaving on one worker read and wrote as each other's
   * organisation; each job now carries its own for the whole of its work.
   */
  async process(job: Job): Promise<void> {
    return runWithTenantContext(
      {
        label: `system:${job.name}#${job.id ?? '?'}`,
      },
      () => this.processInContext(job),
    );
  }

  private async processInContext(job: Job): Promise<void> {
    if (job.name !== SYSTEM_JOB_PING) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_SYSTEM} queue (job ${job.id})`,
      );
      return Promise.resolve();
    }

    this.logger.log(`Processed ${SYSTEM_JOB_PING} job ${job.id}`);
    return Promise.resolve();
  }
}
