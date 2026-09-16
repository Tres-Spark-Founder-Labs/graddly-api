import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { QUEUE_WITHDRAWAL_PUSH } from '../bullmq/bullmq.constants.js';
import { runWithTenantContext } from '../common/context/correlation-id-context.js';

import { WithdrawalCompletionPush } from './entities/withdrawal-completion-push.entity.js';
import { WithdrawalPushStatus } from './enums/withdrawal-push-status.enum.js';
import { WITHDRAWAL_PUSH_JOB_SEND } from './withdrawal-push.constants.js';

import type { IWithdrawalPushJobPayload } from './withdrawal-push.payload.js';

@Injectable()
@Processor(QUEUE_WITHDRAWAL_PUSH)
export class WithdrawalPushProcessor extends WorkerHost {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(WithdrawalCompletionPush)
    private readonly repo: Repository<WithdrawalCompletionPush>,
  ) {
    super();
  }

  /**
   * The job runs inside its own tenant store — what CorrelationIdMiddleware
   * gives a request. The values used to be set on a process-global fallback,
   * so two jobs interleaving on one worker read and wrote as each other's
   * organisation; each job now carries its own for the whole of its work.
   */
  async process(job: Job<IWithdrawalPushJobPayload>): Promise<void> {
    return runWithTenantContext(
      {
        label: `withdrawal-push:${job.name}#${job.id ?? '?'}`,
        organisationId: job.data.organisationId,
        // No sentinel: app.current_user and audit actorUserId are uuids, and a
        // job nobody requested has no acting user. Empty is the honest value.
        userId: job.data.requestedByUserId,
      },
      () => this.processInContext(job),
    );
  }

  private async processInContext(
    job: Job<IWithdrawalPushJobPayload>,
  ): Promise<void> {
    if (job.name !== WITHDRAWAL_PUSH_JOB_SEND) {
      return;
    }
    const { pushId } = job.data;

    const record = await this.repo.findOne({ where: { id: pushId } });
    if (!record) {
      return;
    }

    record.status = WithdrawalPushStatus.PROCESSING;
    record.attempts = (record.attempts ?? 0) + 1;
    await this.repo.save(record);

    const endpoint = this.config.get<string>(
      'app.withdrawalPush.endpointUrl',
      '',
    );
    if (!endpoint) {
      record.status = WithdrawalPushStatus.FAILED;
      record.lastError = 'Withdrawal push endpoint not configured';
      await this.repo.save(record);
      throw new Error(record.lastError);
    }

    try {
      const headers = new Headers();
      headers.set('content-type', 'application/json');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(record.payload),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      record.status = WithdrawalPushStatus.DELIVERED;
      record.deliveredAt = new Date();
      record.lastError = null;
      await this.repo.save(record);
    } catch (error) {
      record.status = WithdrawalPushStatus.FAILED;
      record.lastError = error instanceof Error ? error.message : String(error);
      record.nextRetryAt = new Date(Date.now() + 5 * 60_000);
      await this.repo.save(record);
      throw error;
    }
  }
}
