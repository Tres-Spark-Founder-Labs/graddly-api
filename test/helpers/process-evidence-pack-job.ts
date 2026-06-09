import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { EvidencePackProcessor } from '../../src/bullmq/processors/evidence-pack.processor.js';
import { EvidencePackJob } from '../../src/ofsted/entities/evidence-pack-job.entity.js';
import { EvidencePackBuilderService } from '../../src/ofsted/evidence-pack-builder.service.js';
import { EVIDENCE_PACK_JOB_BUILD } from '../../src/ofsted/evidence-pack.constants.js';
import { StorageKeyBuilder } from '../../src/storage/storage-key.builder.js';
import { StorageService } from '../../src/storage/storage.service.js';

import type { IEvidencePackJobPayload } from '../../src/ofsted/evidence-pack-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';

export async function processEvidencePackJobInApp(
  app: INestApplication,
  payload: IEvidencePackJobPayload,
): Promise<void> {
  const processor = new EvidencePackProcessor(
    app.get(EvidencePackBuilderService),
    app.get(StorageService),
    app.get(StorageKeyBuilder),
    app.get<Repository<EvidencePackJob>>(getRepositoryToken(EvidencePackJob)),
  );

  const job = {
    id: payload.jobId,
    name: EVIDENCE_PACK_JOB_BUILD,
    data: payload,
  } as Job<IEvidencePackJobPayload>;

  await processor.process(job);
}
