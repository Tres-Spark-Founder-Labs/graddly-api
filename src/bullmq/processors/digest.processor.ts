import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { OtjDigestService } from '../../notifications/otj-digest.service.js';
import { DIGEST_JOB_WEEKLY_OTJ, QUEUE_DIGEST } from '../bullmq.constants.js';

import type { IWeeklyOtjDigestJobPayload } from '../../notifications/digest-job.payload.js';

@Processor(QUEUE_DIGEST)
export class DigestProcessor extends WorkerHost {
  private readonly logger = new Logger(DigestProcessor.name);

  constructor(private readonly otjDigestService: OtjDigestService) {
    super();
  }

  async process(job: Job<IWeeklyOtjDigestJobPayload>): Promise<void> {
    switch (job.name) {
      // The job name string stays "weekly-otj-digest" for wire compatibility:
      // it is persisted in Redis, so renaming it would strand jobs already
      // queued at deploy time. The cadence is now per-manager (F1.2.3 AC7).
      case DIGEST_JOB_WEEKLY_OTJ: {
        const sent = await this.otjDigestService.sendDigestForOrganisation(
          job.data.organisationId,
        );
        this.logger.log(
          `OTJ approval digest for org ${job.data.organisationId}: ${sent} email(s) (job ${job.id})`,
        );
        return;
      }
      default:
        this.logger.warn(
          `Unknown job name "${job.name}" on ${QUEUE_DIGEST} queue (job ${job.id})`,
        );
    }
  }
}
