import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import {
  toFailedJobSummaryDto,
  toQueueJobCountsDto,
  toQueueJobDetailDto,
} from './bullmq-job.mapper.js';
import {
  BULLMQ_QUEUES,
  QUEUE_DAS_SYNC,
  QUEUE_DAS_SYNC_DLQ,
  QUEUE_DIGEST,
  QUEUE_EMAIL,
  QUEUE_EVIDENCE_PACK,
  QUEUE_PDF,
  QUEUE_SYSTEM,
  QUEUE_WITHDRAWAL_PUSH,
} from './bullmq.constants.js';
import { FailedJobSummaryDto } from './dto/failed-job-summary.dto.js';
import { QueueJobDetailDto } from './dto/queue-job-detail.dto.js';
import { QueueSummaryDto } from './dto/queue-summary.dto.js';

@Injectable()
export class BullmqJobInspectionService {
  private readonly queues: Map<string, Queue>;

  constructor(
    @InjectQueue(QUEUE_EMAIL) emailQueue: Queue,
    @InjectQueue(QUEUE_DIGEST) digestQueue: Queue,
    @InjectQueue(QUEUE_PDF) pdfQueue: Queue,
    @InjectQueue(QUEUE_DAS_SYNC) dasSyncQueue: Queue,
    @InjectQueue(QUEUE_DAS_SYNC_DLQ) dasSyncDlqQueue: Queue,
    @InjectQueue(QUEUE_WITHDRAWAL_PUSH) withdrawalPushQueue: Queue,
    @InjectQueue(QUEUE_EVIDENCE_PACK) evidencePackQueue: Queue,
    @InjectQueue(QUEUE_SYSTEM) systemQueue: Queue,
  ) {
    this.queues = new Map([
      [QUEUE_EMAIL, emailQueue],
      [QUEUE_DIGEST, digestQueue],
      [QUEUE_PDF, pdfQueue],
      [QUEUE_DAS_SYNC, dasSyncQueue],
      [QUEUE_DAS_SYNC_DLQ, dasSyncDlqQueue],
      [QUEUE_WITHDRAWAL_PUSH, withdrawalPushQueue],
      [QUEUE_EVIDENCE_PACK, evidencePackQueue],
      [QUEUE_SYSTEM, systemQueue],
    ]);
  }

  async listQueues(): Promise<QueueSummaryDto[]> {
    const summaries: QueueSummaryDto[] = [];

    for (const name of BULLMQ_QUEUES) {
      const queue = this.getQueue(name);
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'prioritized',
        'waiting-children',
      );
      summaries.push({
        name,
        counts: toQueueJobCountsDto(counts),
      });
    }

    return summaries;
  }

  async listFailedJobs(
    queueName: string,
    page: number,
    perPage: number,
  ): Promise<PaginatedResult<FailedJobSummaryDto>> {
    const queue = this.getQueue(queueName);
    const total = await queue.getFailedCount();
    const start = (page - 1) * perPage;
    const end = start + perPage - 1;
    const jobs = total > 0 ? await queue.getFailed(start, end) : [];

    return new PaginatedResult(
      jobs.map((job) => toFailedJobSummaryDto(job)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async getJob(queueName: string, jobId: string): Promise<QueueJobDetailDto> {
    const job = await this.resolveJob(queueName, jobId);
    return toQueueJobDetailDto(job);
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.resolveJob(queueName, jobId);
    await job.retry('failed');
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.resolveJob(queueName, jobId);
    await job.remove();
  }

  private getQueue(queueName: string): Queue {
    if (!BULLMQ_QUEUES.includes(queueName as (typeof BULLMQ_QUEUES)[number])) {
      throw new BadRequestException(`Unknown queue: ${queueName}`);
    }

    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new BadRequestException(`Unknown queue: ${queueName}`);
    }

    return queue;
  }

  private async resolveJob(queueName: string, jobId: string): Promise<Job> {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(
        `Job ${jobId} not found on queue ${queueName}`,
      );
    }

    if (job.queueName !== queueName) {
      throw new NotFoundException(
        `Job ${jobId} not found on queue ${queueName}`,
      );
    }

    return job;
  }
}
