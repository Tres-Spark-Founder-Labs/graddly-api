import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { DAS_DLQ_JOB_DEAD_LETTER } from '../../das/das-dlq.constants.js';
import { DasFundingSyncService } from '../../das/das-funding-sync.service.js';
import {
  DAS_JOB_SYNC_FUNDING_PAYMENTS,
  DAS_JOB_SYNC_ORGANISATION,
} from '../../das/das-job.constants.js';
import { DasLevySyncService } from '../../das/das-levy-sync.service.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { QUEUE_DAS_SYNC, QUEUE_DAS_SYNC_DLQ } from '../bullmq.constants.js';

import type { IDasSyncJobPayload } from '../../das/das-job.payload.js';

@Processor(QUEUE_DAS_SYNC)
export class DasSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(DasSyncProcessor.name);

  constructor(
    private readonly dasSyncService: DasLevySyncService,
    private readonly fundingSyncService: DasFundingSyncService,
    @InjectQueue(QUEUE_DAS_SYNC_DLQ) private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IDasSyncJobPayload>): Promise<void> {
    if (
      job.name !== DAS_JOB_SYNC_ORGANISATION &&
      job.name !== DAS_JOB_SYNC_FUNDING_PAYMENTS
    ) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_DAS_SYNC} queue (job ${job.id})`,
      );
      return;
    }

    const { organisationId, requestedByUserId } = job.data;
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(requestedByUserId ?? 'system-das-sync');
    setLastKnownUserIdForGuc(requestedByUserId ?? 'system-das-sync');

    try {
      if (job.name === DAS_JOB_SYNC_FUNDING_PAYMENTS) {
        await this.fundingSyncService.syncOrganisation(
          organisationId,
          requestedByUserId,
        );
        return;
      }

      await this.dasSyncService.syncOrganisation(
        organisationId,
        requestedByUserId,
      );
    } catch (error) {
      const totalAttempts = job.opts.attempts ?? 1;
      const isTerminalFailure = job.attemptsMade + 1 >= totalAttempts;
      if (isTerminalFailure) {
        await this.dlqQueue.add(DAS_DLQ_JOB_DEAD_LETTER, {
          sourceQueue: QUEUE_DAS_SYNC,
          sourceJobId: job.id,
          attemptsMade: job.attemptsMade + 1,
          failedAt: new Date().toISOString(),
          payload: job.data,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }
}
