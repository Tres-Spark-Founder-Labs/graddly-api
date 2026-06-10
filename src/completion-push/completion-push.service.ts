import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { CompletionPushDispatchService } from './completion-push-dispatch.service.js';
import { EnrolmentCompletionPushResponseDto } from './dto/enrolment-completion-push-response.dto.js';
import { EnrolmentCompletionPush } from './entities/enrolment-completion-push.entity.js';
import { CompletionPushStatus } from './enums/completion-push-status.enum.js';
import { CompletionPushTrigger } from './enums/completion-push-trigger.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class CompletionPushService {
  constructor(
    @InjectRepository(EnrolmentCompletionPush)
    private readonly repo: Repository<EnrolmentCompletionPush>,
    private readonly dispatch: CompletionPushDispatchService,
  ) {}

  async queueFromEnrolmentCompleted(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    learnerRef: string;
    completionDate: string;
    requestedByUserId?: string;
  }): Promise<void> {
    await this.queuePush({
      organisationId: input.organisationId,
      enrolmentId: input.enrolmentId,
      apprenticeId: input.apprenticeId,
      trigger: CompletionPushTrigger.ENROLMENT_COMPLETED,
      epaOutcomeId: null,
      payload: {
        type: 'das_completion_notification',
        trigger: CompletionPushTrigger.ENROLMENT_COMPLETED,
        learnerRef: input.learnerRef,
        completionDate: input.completionDate,
        epaOutcome: null,
        enrolmentId: input.enrolmentId,
      },
      requestedByUserId: input.requestedByUserId,
    });
  }

  async queueFromEpaOutcome(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    epaOutcomeId: string;
    learnerRef: string;
    completionDate: string;
    epaOutcome: string;
    requestedByUserId?: string;
  }): Promise<void> {
    await this.queuePush({
      organisationId: input.organisationId,
      enrolmentId: input.enrolmentId,
      apprenticeId: input.apprenticeId,
      trigger: CompletionPushTrigger.EPA_OUTCOME_RECORDED,
      epaOutcomeId: input.epaOutcomeId,
      payload: {
        type: 'das_completion_notification',
        trigger: CompletionPushTrigger.EPA_OUTCOME_RECORDED,
        learnerRef: input.learnerRef,
        completionDate: input.completionDate,
        epaOutcome: input.epaOutcome,
        enrolmentId: input.enrolmentId,
        epaOutcomeId: input.epaOutcomeId,
      },
      requestedByUserId: input.requestedByUserId,
    });
  }

  async listFailed(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EnrolmentCompletionPushResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: {
        organisationId: user.organisationId!,
        status: CompletionPushStatus.FAILED,
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
  ): Promise<EnrolmentCompletionPushResponseDto> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Enrolment completion push not found');
    }
    return this.toResponse(item);
  }

  async retryFailed(user: AuthenticatedUser, id: string): Promise<void> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Enrolment completion push not found');
    }
    item.manualRetryRequestedAt = new Date();
    item.status = CompletionPushStatus.QUEUED;
    await this.repo.save(item);
    await this.dispatch.enqueue({
      pushId: item.id,
      organisationId: item.organisationId,
      requestedByUserId: user.id,
    });
  }

  private async queuePush(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    trigger: CompletionPushTrigger;
    epaOutcomeId: string | null;
    payload: Record<string, unknown>;
    requestedByUserId?: string;
  }): Promise<void> {
    const existing = await this.repo.findOne({
      where: {
        organisationId: input.organisationId,
        enrolmentId: input.enrolmentId,
        trigger: input.trigger,
        isDeleted: false,
      },
    });
    if (existing?.status === CompletionPushStatus.DELIVERED) {
      return;
    }

    const push =
      existing ??
      this.repo.create({
        organisationId: input.organisationId,
        enrolmentId: input.enrolmentId,
        apprenticeId: input.apprenticeId,
        epaOutcomeId: input.epaOutcomeId,
        trigger: input.trigger,
        status: CompletionPushStatus.QUEUED,
        payload: input.payload,
      });

    push.payload = input.payload;
    push.status = CompletionPushStatus.QUEUED;
    push.lastError = null;
    push.epaOutcomeId = input.epaOutcomeId;

    const saved = await this.repo.save(push);
    await this.dispatch.enqueue({
      pushId: saved.id,
      organisationId: saved.organisationId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  private toResponse(
    item: EnrolmentCompletionPush,
  ): EnrolmentCompletionPushResponseDto {
    return {
      id: item.id,
      organisationId: item.organisationId,
      enrolmentId: item.enrolmentId,
      apprenticeId: item.apprenticeId,
      epaOutcomeId: item.epaOutcomeId,
      trigger: item.trigger,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError,
      dasReference: item.dasReference,
      deliveredAt: item.deliveredAt?.toISOString() ?? null,
    };
  }
}
