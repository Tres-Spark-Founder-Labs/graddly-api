import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import {
  QUEUE_COMPLETION_PUSH,
  QUEUE_COMPLETION_PUSH_DLQ,
} from '../bullmq/bullmq.constants.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { DasHttpClient } from '../das/das-http.client.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import {
  COMPLETION_PUSH_DLQ_JOB_DEAD_LETTER,
  COMPLETION_PUSH_JOB_SEND,
} from './completion-push.constants.js';
import { EnrolmentCompletionPush } from './entities/enrolment-completion-push.entity.js';
import { CompletionPushStatus } from './enums/completion-push-status.enum.js';

import type { ICompletionPushJobPayload } from './completion-push.payload.js';
import type { IDasCompletionNotificationRequest } from '../das/das.types.js';

@Injectable()
@Processor(QUEUE_COMPLETION_PUSH)
export class CompletionPushProcessor extends WorkerHost {
  constructor(
    private readonly dasClient: DasHttpClient,
    @InjectRepository(EnrolmentCompletionPush)
    private readonly repo: Repository<EnrolmentCompletionPush>,
    @InjectQueue(QUEUE_COMPLETION_PUSH_DLQ)
    private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ICompletionPushJobPayload>): Promise<void> {
    if (job.name !== COMPLETION_PUSH_JOB_SEND) {
      return;
    }

    const { pushId, organisationId, requestedByUserId } = job.data;
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(requestedByUserId ?? 'system-completion-push');
    setLastKnownUserIdForGuc(requestedByUserId ?? 'system-completion-push');

    const record = await this.repo.findOne({ where: { id: pushId } });
    if (!record) {
      return;
    }
    if (record.status === CompletionPushStatus.DELIVERED) {
      return;
    }

    record.status = CompletionPushStatus.PROCESSING;
    record.attempts = (record.attempts ?? 0) + 1;
    await this.repo.save(record);

    try {
      const request = this.toDasRequest(record.payload);
      const result = await this.dasClient.notifyCompletion(request);
      record.status = CompletionPushStatus.DELIVERED;
      record.deliveredAt = new Date();
      record.dasReference = result.reference;
      record.lastError = null;
      await this.repo.save(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = CompletionPushStatus.FAILED;
      record.lastError = message;
      record.nextRetryAt = new Date(Date.now() + 5 * 60_000);
      await this.repo.save(record);

      const totalAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= totalAttempts) {
        await this.dlqQueue.add(COMPLETION_PUSH_DLQ_JOB_DEAD_LETTER, {
          sourceQueue: QUEUE_COMPLETION_PUSH,
          sourceJobId: job.id,
          pushId,
          attemptsMade: job.attemptsMade + 1,
          failedAt: new Date().toISOString(),
          payload: job.data,
          errorMessage: message,
        });
      }

      throw error;
    }
  }

  private toDasRequest(
    payload: Record<string, unknown>,
  ): IDasCompletionNotificationRequest {
    const learnerRef = this.pickString(payload, 'learnerRef');
    const completionDate = this.pickString(payload, 'completionDate');
    const epaOutcome = this.pickNullableString(payload, 'epaOutcome');

    if (!learnerRef || !completionDate) {
      throw new Error('Completion push payload is missing required DAS fields');
    }

    return { learnerRef, completionDate, epaOutcome };
  }

  private pickString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
  }

  private pickNullableString(
    payload: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = payload[key];
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === 'string' ? value : '';
  }
}
