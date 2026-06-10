import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import {
  QUEUE_ILR_SUBMIT,
  QUEUE_ILR_SUBMIT_DLQ,
} from '../bullmq/bullmq.constants.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { EnrolmentPushService } from '../enrolment-push/enrolment-push.service.js';
import { EnrolmentPushTrigger } from '../enrolment-push/enums/enrolment-push-trigger.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrSubmissionStatus } from './enums/ilr-submission-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import {
  ILR_DLQ_JOB_DEAD_LETTER,
  ILR_SUBMIT_JOB_PROCESS,
} from './ilr-submit.constants.js';
import { ILR_ESFA_CLIENT } from './ilr.constants.js';

import type { IIlrSubmitJobPayload } from './ilr-submit.payload.js';
import type { IIlrEsfaClient } from './interfaces/ilr-esfa.client.interface.js';

@Injectable()
@Processor(QUEUE_ILR_SUBMIT)
export class IlrSubmitProcessor extends WorkerHost {
  private readonly logger = new Logger(IlrSubmitProcessor.name);

  constructor(
    @InjectRepository(IlrSubmission)
    private readonly submissionRepo: Repository<IlrSubmission>,
    @Inject(ILR_ESFA_CLIENT)
    private readonly esfaClient: IIlrEsfaClient,
    private readonly learnerRecordsService: IlrLearnerRecordsService,
    private readonly enrolmentContext: IlrEnrolmentContext,
    private readonly payloadSerializer: IlrPayloadSerializerService,
    private readonly notificationsService: NotificationsService,
    private readonly enrolmentPushService: EnrolmentPushService,
    @InjectQueue(QUEUE_ILR_SUBMIT_DLQ)
    private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IIlrSubmitJobPayload>): Promise<void> {
    if (job.name !== ILR_SUBMIT_JOB_PROCESS) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_ILR_SUBMIT} (job ${job.id})`,
      );
      return;
    }

    const { submissionId, organisationId, requestedByUserId } = job.data;
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(requestedByUserId);
    setLastKnownUserIdForGuc(requestedByUserId);

    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId, organisationId, isDeleted: false },
    });
    if (!submission) {
      return;
    }

    if (submission.status === IlrSubmissionStatus.SUBMITTED) {
      return;
    }

    submission.status = IlrSubmissionStatus.PROCESSING;
    await this.submissionRepo.save(submission);

    try {
      const record = await this.learnerRecordsService.requireRecordEntity(
        organisationId,
        submission.ilrLearnerRecordId,
      );
      const graph = await this.enrolmentContext.requireEnrolmentGraph(
        organisationId,
        record.enrolmentId,
      );
      const ukprn = graph.organisation.ukprn;
      if (!ukprn) {
        throw new Error('Organisation UKPRN is required for ILR submit');
      }

      let priorEsfaReference: string | null = null;
      if (submission.isAmendment && submission.amendsSubmissionId) {
        const prior = await this.submissionRepo.findOne({
          where: {
            id: submission.amendsSubmissionId,
            organisationId,
            isDeleted: false,
          },
        });
        priorEsfaReference = prior?.esfaReference ?? null;
      }

      const payloadInput = {
        organisationId,
        ukprn,
        collectionPeriod: record.collectionPeriod,
        academicYear: record.academicYear,
        fields: record.fields,
        isAmendment: submission.isAmendment,
        priorEsfaReference,
        learnerRecordId: record.id,
      };
      const submitRequest =
        this.payloadSerializer.toSubmitRequest(payloadInput);
      submission.requestPayload =
        this.payloadSerializer.toRequestBody(payloadInput);
      await this.submissionRepo.save(submission);

      const result = await this.esfaClient.submit(submitRequest);

      submission.status = IlrSubmissionStatus.SUBMITTED;
      submission.esfaReference = result.esfaReference;
      submission.receipt = result.receipt;
      submission.submittedAt = new Date();
      submission.failedAt = null;
      submission.lastError = null;
      await this.submissionRepo.save(submission);

      await this.notificationsService.createForUser({
        organisationId,
        userId: requestedByUserId,
        type: NotificationType.ILR_SUBMISSION_SUCCEEDED,
        title: submission.isAmendment
          ? 'ILR amendment succeeded'
          : 'ILR submission succeeded',
        body: `ILR record submitted with reference ${result.esfaReference}.`,
        metadata: {
          submissionId: submission.id,
          learnerRecordId: record.id,
        },
      });

      await this.enrolmentPushService.queueFromIlrRecord({
        organisationId,
        graph,
        fields: record.fields,
        ilrLearnerRecordId: record.id,
        ilrSubmissionId: submission.id,
        trigger: EnrolmentPushTrigger.ILR_SUBMITTED,
        requestedByUserId,
      });
    } catch (error) {
      const message = this.toMessage(error);
      submission.lastError = message;

      const totalAttempts = job.opts.attempts ?? 1;
      const isTerminalFailure = job.attemptsMade + 1 >= totalAttempts;

      if (isTerminalFailure) {
        submission.status = IlrSubmissionStatus.FAILED;
        submission.failedAt = new Date();
        await this.submissionRepo.save(submission);

        await this.notificationsService.createForUser({
          organisationId,
          userId: requestedByUserId,
          type: NotificationType.ILR_SUBMISSION_FAILED,
          title: submission.isAmendment
            ? 'ILR amendment failed'
            : 'ILR submission failed',
          body: message,
          metadata: {
            submissionId: submission.id,
            learnerRecordId: submission.ilrLearnerRecordId,
          },
        });

        await this.dlqQueue.add(ILR_DLQ_JOB_DEAD_LETTER, {
          sourceQueue: QUEUE_ILR_SUBMIT,
          sourceJobId: job.id,
          submissionId,
          attemptsMade: job.attemptsMade + 1,
          failedAt: new Date().toISOString(),
          payload: job.data,
          errorMessage: message,
        });
      } else {
        await this.submissionRepo.save(submission);
      }

      throw error;
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
