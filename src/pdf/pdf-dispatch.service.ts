import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { v4 as uuidV4 } from 'uuid';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_PDF } from '../bullmq/bullmq.constants.js';

import { PdfGenerationJob } from './entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from './enums/pdf-job-status.enum.js';
import { PDF_JOB_GENERATE } from './pdf-job.constants.js';

import type { PdfJobTemplate } from './enums/pdf-job-template.enum.js';
import type { IPdfJobPayload } from './pdf-job.payload.js';

@Injectable()
export class PdfDispatchService {
  constructor(
    @InjectQueue(QUEUE_PDF) private readonly pdfQueue: Queue,
    @InjectRepository(PdfGenerationJob)
    private readonly jobRepo: Repository<PdfGenerationJob>,
  ) {}

  async enqueue(input: {
    organisationId: string;
    userId: string;
    template: PdfJobTemplate;
    reviewId?: string;
    statementId?: string;
    transferId?: string;
  }): Promise<PdfGenerationJob> {
    const jobId = uuidV4();
    const job = this.jobRepo.create({
      id: jobId,
      organisationId: input.organisationId,
      requestedByUserId: input.userId,
      template: input.template,
      status: PdfJobStatus.QUEUED,
    });
    await this.jobRepo.save(job);

    const payload: IPdfJobPayload = {
      jobId,
      organisationId: input.organisationId,
      userId: input.userId,
      template: input.template,
      reviewId: input.reviewId,
      statementId: input.statementId,
      transferId: input.transferId,
    };

    await this.pdfQueue.add(PDF_JOB_GENERATE, payload, {
      ...bullmqDefaultJobOptions,
      jobId,
    });

    return job;
  }
}
