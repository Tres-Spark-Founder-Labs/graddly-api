import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { EpaPackProcessor } from '../../src/bullmq/processors/epa-pack.processor.js';
import { EpaPackJob } from '../../src/portfolio/entities/epa-pack-job.entity.js';
import { EpaPackBuilderService } from '../../src/portfolio/epa-pack-builder.service.js';
import { EPA_PACK_JOB_BUILD } from '../../src/portfolio/epa-pack.constants.js';
import { StorageKeyBuilder } from '../../src/storage/storage-key.builder.js';
import { StorageService } from '../../src/storage/storage.service.js';

import type { IEpaPackJobPayload } from '../../src/portfolio/epa-pack-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';

export async function processEpaPackJobInApp(
  app: INestApplication,
  payload: IEpaPackJobPayload,
): Promise<void> {
  const processor = new EpaPackProcessor(
    app.get(EpaPackBuilderService),
    app.get(StorageService),
    app.get(StorageKeyBuilder),
    app.get<Repository<EpaPackJob>>(getRepositoryToken(EpaPackJob)),
  );

  const job = {
    id: payload.jobId,
    name: EPA_PACK_JOB_BUILD,
    data: payload,
  } as Job<IEpaPackJobPayload>;

  await processor.process(job);
}
