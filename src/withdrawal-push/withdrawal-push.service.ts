import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { WithdrawalCompletionPushResponseDto } from './dto/withdrawal-completion-push-response.dto.js';
import { WithdrawalCompletionPush } from './entities/withdrawal-completion-push.entity.js';
import { WithdrawalPushStatus } from './enums/withdrawal-push-status.enum.js';
import { WithdrawalPushDispatchService } from './withdrawal-push-dispatch.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class WithdrawalPushService {
  constructor(
    @InjectRepository(WithdrawalCompletionPush)
    private readonly repo: Repository<WithdrawalCompletionPush>,
    private readonly dispatch: WithdrawalPushDispatchService,
  ) {}

  async queueFromEnrolment(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    requestedByUserId?: string;
  }): Promise<void> {
    const push = this.repo.create({
      organisationId: input.organisationId,
      enrolmentId: input.enrolmentId,
      apprenticeId: input.apprenticeId,
      status: WithdrawalPushStatus.QUEUED,
      payload: {
        type: 'enrolment_withdrawal_completion',
        organisationId: input.organisationId,
        enrolmentId: input.enrolmentId,
        apprenticeId: input.apprenticeId,
        occurredAt: new Date().toISOString(),
      },
    });
    const saved = await this.repo.save(push);
    await this.dispatch.enqueue({
      pushId: saved.id,
      organisationId: saved.organisationId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  /**
   * F2.2.4 AC6 — "notify DAS" of a break in learning.
   *
   * Rides the existing push pipeline rather than growing a second one: the
   * payload is already a discriminated jsonb, and retry, backoff, manual
   * retry and delivery status are all things a break notification needs and
   * this pipeline already has.
   *
   * A break is not a withdrawal, and the `type` says so. The learner is
   * expected back — the ESFA needs the pause recorded because planned break
   * duration moves the expected end date and the funding schedule with it.
   */
  async queueFromBreakInLearning(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    reason: string;
    startedOn: string;
    expectedReturnDate: string | null;
    requestedByUserId?: string;
  }): Promise<void> {
    const push = this.repo.create({
      organisationId: input.organisationId,
      enrolmentId: input.enrolmentId,
      apprenticeId: input.apprenticeId,
      status: WithdrawalPushStatus.QUEUED,
      payload: {
        type: 'break_in_learning_started',
        organisationId: input.organisationId,
        enrolmentId: input.enrolmentId,
        apprenticeId: input.apprenticeId,
        reason: input.reason,
        startedOn: input.startedOn,
        expectedReturnDate: input.expectedReturnDate,
        occurredAt: new Date().toISOString(),
      },
    });
    const saved = await this.repo.save(push);
    await this.dispatch.enqueue({
      pushId: saved.id,
      organisationId: saved.organisationId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  /** F2.2.4 AC6 — the learner has returned; the pause is over. */
  async queueFromBreakInLearningEnded(input: {
    organisationId: string;
    enrolmentId: string;
    apprenticeId: string;
    actualReturnDate: string;
    requestedByUserId?: string;
  }): Promise<void> {
    const push = this.repo.create({
      organisationId: input.organisationId,
      enrolmentId: input.enrolmentId,
      apprenticeId: input.apprenticeId,
      status: WithdrawalPushStatus.QUEUED,
      payload: {
        type: 'break_in_learning_ended',
        organisationId: input.organisationId,
        enrolmentId: input.enrolmentId,
        apprenticeId: input.apprenticeId,
        actualReturnDate: input.actualReturnDate,
        occurredAt: new Date().toISOString(),
      },
    });
    const saved = await this.repo.save(push);
    await this.dispatch.enqueue({
      pushId: saved.id,
      organisationId: saved.organisationId,
      requestedByUserId: input.requestedByUserId,
    });
  }

  async queueFromApprenticeWithdrawal(input: {
    organisationId: string;
    apprenticeId: string;
    requestedByUserId?: string;
  }): Promise<void> {
    const push = this.repo.create({
      organisationId: input.organisationId,
      enrolmentId: null,
      apprenticeId: input.apprenticeId,
      status: WithdrawalPushStatus.QUEUED,
      payload: {
        type: 'apprentice_withdrawal_completion',
        organisationId: input.organisationId,
        apprenticeId: input.apprenticeId,
        occurredAt: new Date().toISOString(),
      },
    });
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
  ): Promise<PaginatedResult<WithdrawalCompletionPushResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: {
        organisationId: user.organisationId!,
        status: WithdrawalPushStatus.FAILED,
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
  ): Promise<WithdrawalCompletionPushResponseDto> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Withdrawal completion push not found');
    }
    return this.toResponse(item);
  }

  async retryFailed(user: AuthenticatedUser, id: string): Promise<void> {
    const item = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException('Withdrawal completion push not found');
    }
    item.manualRetryRequestedAt = new Date();
    item.status = WithdrawalPushStatus.QUEUED;
    await this.repo.save(item);
    await this.dispatch.enqueue({
      pushId: item.id,
      organisationId: item.organisationId,
      requestedByUserId: user.id,
    });
  }

  private toResponse(
    item: WithdrawalCompletionPush,
  ): WithdrawalCompletionPushResponseDto {
    return {
      id: item.id,
      organisationId: item.organisationId,
      enrolmentId: item.enrolmentId,
      apprenticeId: item.apprenticeId,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError,
      deliveredAt: item.deliveredAt?.toISOString() ?? null,
    };
  }
}
