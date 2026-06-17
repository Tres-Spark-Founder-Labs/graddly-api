import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { v4 as uuidV4 } from 'uuid';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_EPA_PACK } from '../bullmq/bullmq.constants.js';

import { CreateEpaPackJobDto } from './dto/create-epa-pack-job.dto.js';
import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';
import { EPA_PACK_JOB_BUILD } from './epa-pack.constants.js';

import type { IEpaPackJobPayload } from './epa-pack-job.payload.js';

@Injectable()
export class EpaPackDispatchService {
  constructor(
    @InjectQueue(QUEUE_EPA_PACK) private readonly queue: Queue,
    @InjectRepository(EpaPackJob)
    private readonly jobRepo: Repository<EpaPackJob>,
  ) {}

  async enqueue(
    organisationId: string,
    userId: string,
    dto: CreateEpaPackJobDto,
  ): Promise<EpaPackJob> {
    const jobId = uuidV4();
    const job = this.jobRepo.create({
      id: jobId,
      organisationId,
      enrolmentId: dto.enrolmentId,
      requestedByUserId: userId,
      status: EpaPackJobStatus.QUEUED,
    });
    await this.jobRepo.save(job);

    const payload: IEpaPackJobPayload = {
      jobId,
      organisationId,
      userId,
      enrolmentId: dto.enrolmentId,
    };

    await this.queue.add(EPA_PACK_JOB_BUILD, payload, {
      ...bullmqDefaultJobOptions,
      jobId,
    });

    return job;
  }
}
