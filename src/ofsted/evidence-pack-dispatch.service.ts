import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { v4 as uuidV4 } from 'uuid';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_EVIDENCE_PACK } from '../bullmq/bullmq.constants.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

import { CreateEvidencePackJobDto } from './dto/create-evidence-pack-job.dto.js';
import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { EvidencePackJobStatus } from './enums/evidence-pack-job-status.enum.js';
import { EVIDENCE_PACK_JOB_BUILD } from './evidence-pack.constants.js';

import type { IEvidencePackJobPayload } from './evidence-pack-job.payload.js';

@Injectable()
export class EvidencePackDispatchService {
  constructor(
    @InjectQueue(QUEUE_EVIDENCE_PACK) private readonly queue: Queue,
    @InjectRepository(EvidencePackJob)
    private readonly jobRepo: Repository<EvidencePackJob>,
    private readonly keyBuilder: StorageKeyBuilder,
  ) {}

  async enqueue(
    organisationId: string,
    userId: string,
    dto: CreateEvidencePackJobDto,
  ): Promise<EvidencePackJob> {
    const additionalStorageKeys = dto.additionalStorageKeys ?? [];
    for (const key of additionalStorageKeys) {
      if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
        throw new BadRequestException(`Invalid storage key: ${key}`);
      }
    }

    const jobId = uuidV4();
    const job = this.jobRepo.create({
      id: jobId,
      organisationId,
      requestedByUserId: userId,
      status: EvidencePackJobStatus.QUEUED,
      additionalStorageKeys: additionalStorageKeys.length
        ? additionalStorageKeys
        : null,
    });
    await this.jobRepo.save(job);

    const payload: IEvidencePackJobPayload = {
      jobId,
      organisationId,
      userId,
      additionalStorageKeys,
    };

    await this.queue.add(EVIDENCE_PACK_JOB_BUILD, payload, {
      ...bullmqDefaultJobOptions,
      jobId,
    });

    return job;
  }
}
