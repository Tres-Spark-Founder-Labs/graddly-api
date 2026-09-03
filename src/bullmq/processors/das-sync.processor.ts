import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { isDasManualMode } from '../../das/das-client.factory.js';
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
    private readonly config: ConfigService,
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

    /**
     * Nothing to sync when the platform is running on manually-entered
     * figures, so the job is skipped rather than attempted.
     *
     * The 409 on `POST /das/sync` does not cover this path.
     * `das-sync-cron.service.ts` and `das-funding-sync-cron.service.ts` both
     * reach `syncOrganisation` through `DasSyncDispatchService`, which enqueues
     * straight onto this queue — the controller is never involved. Without a
     * guard here the cron would run every night against `DasManualClient`, and
     * `das-levy-sync.service.ts` would stamp `lastSyncStatus = SUCCESS` with a
     * fresh `lastSyncedAt` over figures a person typed weeks ago.
     *
     * Skipped, not thrown. The catch below routes terminal failures to
     * `QUEUE_DAS_SYNC_DLQ`, so raising here would fill the dead letter queue
     * with jobs that were refused correctly — turning an expected state into an
     * operational alert somebody has to clear.
     */
    if (isDasManualMode(this.config)) {
      this.logger.log(
        `Skipping ${job.name} for organisation ${job.data.organisationId}: ` +
          'DAS is in manual mode, so there is nothing to sync.',
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
