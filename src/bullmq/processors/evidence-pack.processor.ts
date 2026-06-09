import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { EvidencePackJob } from '../../ofsted/entities/evidence-pack-job.entity.js';
import { EvidencePackJobStatus } from '../../ofsted/enums/evidence-pack-job-status.enum.js';
import { EvidencePackBuilderService } from '../../ofsted/evidence-pack-builder.service.js';
import { EVIDENCE_PACK_JOB_BUILD } from '../../ofsted/evidence-pack.constants.js';
import { StorageObjectCategory } from '../../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../../storage/storage-key.builder.js';
import { StorageService } from '../../storage/storage.service.js';
import { QUEUE_EVIDENCE_PACK } from '../bullmq.constants.js';

import type { IEvidencePackJobPayload } from '../../ofsted/evidence-pack-job.payload.js';

@Processor(QUEUE_EVIDENCE_PACK)
export class EvidencePackProcessor extends WorkerHost {
  private readonly logger = new Logger(EvidencePackProcessor.name);

  constructor(
    private readonly builder: EvidencePackBuilderService,
    private readonly storage: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
    @InjectRepository(EvidencePackJob)
    private readonly jobRepo: Repository<EvidencePackJob>,
  ) {
    super();
  }

  async process(job: Job<IEvidencePackJobPayload>): Promise<void> {
    if (job.name !== EVIDENCE_PACK_JOB_BUILD) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_EVIDENCE_PACK} (job ${job.id})`,
      );
      return;
    }

    const { jobId, organisationId, userId, additionalStorageKeys } = job.data;
    setCurrentUserId(userId);
    setCurrentOrganisationId(organisationId);
    setLastKnownUserIdForGuc(userId);

    await this.jobRepo.update(jobId, {
      status: EvidencePackJobStatus.PROCESSING,
    });

    try {
      const { buffer, manifest } = await this.builder.buildZipBuffer(
        organisationId,
        additionalStorageKeys ?? [],
      );

      const outputKey = this.keyBuilder.build({
        organisationId,
        category: StorageObjectCategory.EXPORT,
        filename: `ofsted-evidence-pack-${jobId}.zip`,
      });

      await this.storage.putObject(
        organisationId,
        outputKey,
        buffer,
        'application/zip',
      );

      await this.jobRepo.update(jobId, {
        status: EvidencePackJobStatus.COMPLETED,
        outputKey,
        manifest,
        completedAt: new Date(),
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobRepo.update(jobId, {
        status: EvidencePackJobStatus.FAILED,
        errorMessage: message,
      });
      throw error;
    }
  }
}
