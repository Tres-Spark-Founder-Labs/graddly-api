import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { EnrolmentSubmissionPushResponseDto } from './dto/enrolment-submission-push-response.dto.js';
import { EnrolmentPushDispatchService } from './enrolment-push-dispatch.service.js';
import {
  buildEnrolmentPushPayload,
  type IEnrolmentPushGraph,
} from './enrolment-push-payload.builder.js';
import { EnrolmentSubmissionPush } from './entities/enrolment-submission-push.entity.js';
import { EnrolmentPushStatus } from './enums/enrolment-push-status.enum.js';
import { EnrolmentPushTrigger } from './enums/enrolment-push-trigger.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class EnrolmentPushService {
  constructor(
    @InjectRepository(EnrolmentSubmissionPush)
    private readonly repo: Repository<EnrolmentSubmissionPush>,
    private readonly dispatch: EnrolmentPushDispatchService,
  ) {}

  async queueFromIlrRecord(input: {
    organisationId: string;
    graph: IEnrolmentPushGraph;
    fields: Record<string, unknown>;
    ilrLearnerRecordId: string;
    ilrSubmissionId?: string | null;
    trigger: EnrolmentPushTrigger;
    requestedByUserId?: string;
  }): Promise<void> {
    const existing = await this.repo.findOne({
      where: {
        organisationId: input.organisationId,
        ilrLearnerRecordId: input.ilrLearnerRecordId,
        trigger: input.trigger,
        isDeleted: false,
      },
    });
    if (existing?.status === EnrolmentPushStatus.DELIVERED) {
      return;
    }

    const payload = buildEnrolmentPushPayload({
      graph: input.graph,
      fields: input.fields,
      trigger: input.trigger,
      ilrLearnerRecordId: input.ilrLearnerRecordId,
      ilrSubmissionId: input.ilrSubmissionId,
    });

    const push =
      existing ??
      this.repo.create({
        organisationId: input.organisationId,
        enrolmentId: input.graph.enrolment.id,
        apprenticeId: input.graph.apprentice.id,
        ilrLearnerRecordId: input.ilrLearnerRecordId,
        ilrSubmissionId: input.ilrSubmissionId ?? null,
        trigger: input.trigger,
        status: EnrolmentPushStatus.QUEUED,
        payload,
      });

    push.payload = payload;
    push.status = EnrolmentPushStatus.QUEUED;
    push.lastError = null;
    if (input.ilrSubmissionId) {
      push.ilrSubmissionId = input.ilrSubmissionId;
    }

    const saved = await this.repo.save(push);
    await this.dispatch.enqueue({
      pushId: saved.id,
      organisationId: saved.organisationId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  async listFailed(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EnrolmentSubmissionPushResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: {
        organisationId: user.organisationId!,
        status: EnrolmentPushStatus.FAILED,
        isDeleted: false,
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return new PaginatedResult(
      items.map((item) => this.toResponse(item)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async getOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<EnrolmentSubmissionPushResponseDto> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Enrolment submission push not found');
    }
    return this.toResponse(item);
  }

  async retryFailed(user: AuthenticatedUser, id: string): Promise<void> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Enrolment submission push not found');
    }
    item.manualRetryRequestedAt = new Date();
    item.status = EnrolmentPushStatus.QUEUED;
    await this.repo.save(item);
    await this.dispatch.enqueue({
      pushId: item.id,
      organisationId: item.organisationId,
      requestedByUserId: user.id,
    });
  }

  private toResponse(
    item: EnrolmentSubmissionPush,
  ): EnrolmentSubmissionPushResponseDto {
    return {
      id: item.id,
      organisationId: item.organisationId,
      enrolmentId: item.enrolmentId,
      apprenticeId: item.apprenticeId,
      ilrLearnerRecordId: item.ilrLearnerRecordId,
      ilrSubmissionId: item.ilrSubmissionId,
      trigger: item.trigger,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError,
      dasReference: item.dasReference,
      deliveredAt: item.deliveredAt?.toISOString() ?? null,
    };
  }
}
