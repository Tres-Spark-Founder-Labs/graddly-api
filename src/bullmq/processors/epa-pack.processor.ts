import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { runWithTenantContext } from '../../common/context/correlation-id-context.js';
import { EpaPackJob } from '../../portfolio/entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from '../../portfolio/enums/epa-pack-job-status.enum.js';
import { EpaPackBuilderService } from '../../portfolio/epa-pack-builder.service.js';
import { EPA_PACK_JOB_BUILD } from '../../portfolio/epa-pack.constants.js';
import { StorageObjectCategory } from '../../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../../storage/storage-key.builder.js';
import { StorageService } from '../../storage/storage.service.js';
import { QUEUE_EPA_PACK } from '../bullmq.constants.js';

import type { IEpaPackJobPayload } from '../../portfolio/epa-pack-job.payload.js';

@Processor(QUEUE_EPA_PACK)
export class EpaPackProcessor extends WorkerHost {
  private readonly logger = new Logger(EpaPackProcessor.name);

  constructor(
    private readonly builder: EpaPackBuilderService,
    private readonly storage: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
    @InjectRepository(EpaPackJob)
    private readonly jobRepo: Repository<EpaPackJob>,
  ) {
    super();
  }

  /**
   * The job runs inside its own tenant store — what CorrelationIdMiddleware
   * gives a request. The values used to be set on a process-global fallback,
   * so two jobs interleaving on one worker read and wrote as each other's
   * organisation; each job now carries its own for the whole of its work.
   */
  async process(job: Job<IEpaPackJobPayload>): Promise<void> {
    return runWithTenantContext(
      {
        label: `epa-pack:${job.name}#${job.id ?? '?'}`,
        organisationId: job.data.organisationId,
        userId: job.data.userId,
      },
      () => this.processInContext(job),
    );
  }

  private async processInContext(job: Job<IEpaPackJobPayload>): Promise<void> {
    if (job.name !== EPA_PACK_JOB_BUILD) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_EPA_PACK} (job ${job.id})`,
      );
      return;
    }

    const { jobId, organisationId, userId, enrolmentId } = job.data;

    await this.jobRepo.update(jobId, {
      status: EpaPackJobStatus.PROCESSING,
    });

    try {
      const { buffer, manifest } = await this.builder.buildZipBuffer(
        organisationId,
        enrolmentId,
        userId,
      );

      const outputKey = this.keyBuilder.build({
        organisationId,
        category: StorageObjectCategory.EXPORT,
        filename: `epa-evidence-pack-${jobId}.zip`,
      });

      await this.storage.putObject(
        organisationId,
        outputKey,
        buffer,
        'application/zip',
      );

      await this.jobRepo.update(jobId, {
        status: EpaPackJobStatus.COMPLETED,
        outputKey,
        manifest,
        completedAt: new Date(),
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobRepo.update(jobId, {
        status: EpaPackJobStatus.FAILED,
        errorMessage: message,
      });
      throw error;
    }
  }
}
