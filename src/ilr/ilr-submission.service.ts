/**
 * Async ILR submit/amend orchestration — enqueues BullMQ jobs for ESFA delivery.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { IlrSubmissionResponseDto } from './dto/ilr-submission-response.dto.js';
import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrSubmissionStatus } from './enums/ilr-submission-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { IlrSubmitDispatchService } from './ilr-submit-dispatch.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class IlrSubmissionService {
  constructor(
    @InjectRepository(IlrSubmission)
    private readonly submissionRepo: Repository<IlrSubmission>,
    private readonly learnerRecordsService: IlrLearnerRecordsService,
    private readonly enrolmentContext: IlrEnrolmentContext,
    private readonly payloadSerializer: IlrPayloadSerializerService,
    private readonly statusService: IlrLearnerRecordStatusService,
    private readonly submitDispatch: IlrSubmitDispatchService,
  ) {}

  async submit(
    user: AuthenticatedUser,
    learnerRecordId: string,
  ): Promise<IlrSubmissionResponseDto> {
    this.assertOwnerOrAdmin(user);
    const organisationId = user.organisationId!;
    const record = await this.learnerRecordsService.requireRecordEntity(
      organisationId,
      learnerRecordId,
    );
    this.statusService.assertCanSubmit(record.status);

    await this.assertNoInFlightSubmission(learnerRecordId);

    const graph = await this.enrolmentContext.requireEnrolmentGraph(
      organisationId,
      record.enrolmentId,
    );
    const ukprn = graph.organisation.ukprn;
    if (!ukprn) {
      throw new BadRequestException(
        'Organisation UKPRN is required for ILR submit',
      );
    }

    const attempt = (await this.countSubmissions(learnerRecordId)) + 1;
    const payloadInput = {
      organisationId,
      ukprn,
      collectionPeriod: record.collectionPeriod,
      academicYear: record.academicYear,
      fields: record.fields,
      isAmendment: false,
      priorEsfaReference: null,
      learnerRecordId: record.id,
    };

    let submission = this.submissionRepo.create({
      organisationId,
      ilrLearnerRecordId: record.id,
      attempt,
      isAmendment: false,
      amendsSubmissionId: null,
      status: IlrSubmissionStatus.QUEUED,
      requestPayload: this.payloadSerializer.toRequestBody(payloadInput),
      requestedByUserId: user.id,
      esfaReference: null,
      receipt: null,
      submittedAt: null,
      failedAt: null,
      lastError: null,
    });
    submission = await this.submissionRepo.save(submission);

    await this.submitDispatch.enqueue({
      submissionId: submission.id,
      organisationId,
      requestedByUserId: user.id,
    });

    return this.toResponse(submission);
  }

  async amend(
    user: AuthenticatedUser,
    learnerRecordId: string,
  ): Promise<IlrSubmissionResponseDto> {
    this.assertOwnerOrAdmin(user);
    const organisationId = user.organisationId!;
    const record = await this.learnerRecordsService.requireRecordEntity(
      organisationId,
      learnerRecordId,
    );
    this.statusService.assertCanSubmit(record.status);

    await this.assertNoInFlightSubmission(learnerRecordId);

    const prior = await this.submissionRepo.findOne({
      where: {
        ilrLearnerRecordId: learnerRecordId,
        organisationId,
        status: IlrSubmissionStatus.SUBMITTED,
        isDeleted: false,
      },
      order: { attempt: 'DESC' },
    });
    if (!prior?.esfaReference) {
      throw new BadRequestException(
        'A successful prior submission is required before amending',
      );
    }

    const graph = await this.enrolmentContext.requireEnrolmentGraph(
      organisationId,
      record.enrolmentId,
    );
    const ukprn = graph.organisation.ukprn;
    if (!ukprn) {
      throw new BadRequestException(
        'Organisation UKPRN is required for ILR amend',
      );
    }

    const attempt = prior.attempt + 1;
    const payloadInput = {
      organisationId,
      ukprn,
      collectionPeriod: record.collectionPeriod,
      academicYear: record.academicYear,
      fields: record.fields,
      isAmendment: true,
      priorEsfaReference: prior.esfaReference,
      learnerRecordId: record.id,
    };

    let submission = this.submissionRepo.create({
      organisationId,
      ilrLearnerRecordId: record.id,
      attempt,
      isAmendment: true,
      amendsSubmissionId: prior.id,
      status: IlrSubmissionStatus.QUEUED,
      requestPayload: this.payloadSerializer.toRequestBody(payloadInput),
      requestedByUserId: user.id,
      esfaReference: null,
      receipt: null,
      submittedAt: null,
      failedAt: null,
      lastError: null,
    });
    submission = await this.submissionRepo.save(submission);

    await this.submitDispatch.enqueue({
      submissionId: submission.id,
      organisationId,
      requestedByUserId: user.id,
    });

    return this.toResponse(submission);
  }

  async listForRecord(
    user: AuthenticatedUser,
    learnerRecordId: string,
  ): Promise<IlrSubmissionResponseDto[]> {
    const organisationId = user.organisationId!;
    await this.learnerRecordsService.requireRecordEntity(
      organisationId,
      learnerRecordId,
    );

    const rows = await this.submissionRepo.find({
      where: {
        organisationId,
        ilrLearnerRecordId: learnerRecordId,
        isDeleted: false,
      },
      order: { attempt: 'ASC' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<IlrSubmissionResponseDto> {
    const row = await this.submissionRepo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) {
      throw new NotFoundException('ILR submission not found');
    }
    return this.toResponse(row);
  }

  private async assertNoInFlightSubmission(
    learnerRecordId: string,
  ): Promise<void> {
    const inFlight = await this.submissionRepo.findOne({
      where: {
        ilrLearnerRecordId: learnerRecordId,
        status: In([
          IlrSubmissionStatus.QUEUED,
          IlrSubmissionStatus.PROCESSING,
        ]),
        isDeleted: false,
      },
    });
    if (inFlight) {
      throw new ConflictException(
        'An ILR submission is already in progress for this learner record',
      );
    }
  }

  private async countSubmissions(learnerRecordId: string): Promise<number> {
    return this.submissionRepo.count({
      where: { ilrLearnerRecordId: learnerRecordId, isDeleted: false },
    });
  }

  private assertOwnerOrAdmin(user: AuthenticatedUser): void {
    const roles = user.roles ?? [];
    if (
      !roles.includes(OrganisationRole.OWNER) &&
      !roles.includes(OrganisationRole.ADMIN)
    ) {
      throw new BadRequestException(
        'Only organisation owners or admins can submit ILR records',
      );
    }
  }

  private toResponse(entity: IlrSubmission): IlrSubmissionResponseDto {
    return {
      id: entity.id,
      organisationId: entity.organisationId,
      ilrLearnerRecordId: entity.ilrLearnerRecordId,
      attempt: entity.attempt,
      isAmendment: entity.isAmendment,
      amendsSubmissionId: entity.amendsSubmissionId,
      status: entity.status,
      esfaReference: entity.esfaReference,
      receipt: entity.receipt,
      submittedAt: entity.submittedAt?.toISOString() ?? null,
      failedAt: entity.failedAt?.toISOString() ?? null,
      lastError: entity.lastError,
      requestPayload: entity.requestPayload,
      requestedByUserId: entity.requestedByUserId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
