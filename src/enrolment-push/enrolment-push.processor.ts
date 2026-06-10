import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import {
  QUEUE_ENROLMENT_PUSH,
  QUEUE_ENROLMENT_PUSH_DLQ,
} from '../bullmq/bullmq.constants.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { DasHttpClient } from '../das/das-http.client.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { EnrolmentPipelineService } from '../enrolments/enrolment-pipeline.service.js';
import { EnrolmentPipelineState } from '../enrolments/enums/enrolment-pipeline-state.enum.js';

import {
  ENROLMENT_PUSH_DLQ_JOB_DEAD_LETTER,
  ENROLMENT_PUSH_JOB_SEND,
} from './enrolment-push.constants.js';
import { EnrolmentSubmissionPush } from './entities/enrolment-submission-push.entity.js';
import { EnrolmentPushStatus } from './enums/enrolment-push-status.enum.js';

import type { IEnrolmentPushJobPayload } from './enrolment-push.payload.js';
import type { IDasEnrolmentSubmissionRequest } from '../das/das.types.js';

@Injectable()
@Processor(QUEUE_ENROLMENT_PUSH)
export class EnrolmentPushProcessor extends WorkerHost {
  constructor(
    private readonly dasClient: DasHttpClient,
    private readonly enrolmentPipelineService: EnrolmentPipelineService,
    @InjectRepository(EnrolmentSubmissionPush)
    private readonly repo: Repository<EnrolmentSubmissionPush>,
    @InjectQueue(QUEUE_ENROLMENT_PUSH_DLQ)
    private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IEnrolmentPushJobPayload>): Promise<void> {
    if (job.name !== ENROLMENT_PUSH_JOB_SEND) {
      return;
    }

    const { pushId, organisationId, requestedByUserId } = job.data;
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(requestedByUserId ?? 'system-enrolment-push');
    setLastKnownUserIdForGuc(requestedByUserId ?? 'system-enrolment-push');

    const record = await this.repo.findOne({ where: { id: pushId } });
    if (!record) {
      return;
    }
    if (record.status === EnrolmentPushStatus.DELIVERED) {
      return;
    }

    record.status = EnrolmentPushStatus.PROCESSING;
    record.attempts = (record.attempts ?? 0) + 1;
    await this.repo.save(record);

    try {
      const request = this.toDasRequest(record.payload);
      const result = await this.dasClient.submitEnrolment(request);
      record.status = EnrolmentPushStatus.DELIVERED;
      record.deliveredAt = new Date();
      record.dasReference = result.reference;
      record.lastError = null;
      await this.repo.save(record);
      await this.enrolmentPipelineService.advanceIfAhead(
        record.enrolmentId,
        EnrolmentPipelineState.DAS_CONFIRMED,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = EnrolmentPushStatus.FAILED;
      record.lastError = message;
      record.nextRetryAt = new Date(Date.now() + 5 * 60_000);
      await this.repo.save(record);

      const totalAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= totalAttempts) {
        await this.dlqQueue.add(ENROLMENT_PUSH_DLQ_JOB_DEAD_LETTER, {
          sourceQueue: QUEUE_ENROLMENT_PUSH,
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
  ): IDasEnrolmentSubmissionRequest {
    const ukprn = this.pickString(payload, 'ukprn');
    const learnerRef = this.pickString(payload, 'learnerRef');
    const standardCode = this.pickString(payload, 'standardCode');
    const givenNames = this.pickString(payload, 'givenNames');
    const familyName = this.pickString(payload, 'familyName');
    const plannedStartDate = this.pickString(payload, 'plannedStartDate');
    const plannedEndDate = this.pickNullableString(payload, 'plannedEndDate');

    if (!ukprn || !learnerRef || !standardCode || !plannedStartDate) {
      throw new Error('Enrolment push payload is missing required DAS fields');
    }

    return {
      ukprn,
      learnerRef,
      standardCode,
      givenNames,
      familyName,
      plannedStartDate,
      plannedEndDate,
    };
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
