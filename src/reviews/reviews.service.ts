import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';

import { BulkScheduleReviewsResponseDto } from './dto/bulk-schedule-reviews-response.dto.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto.js';
import { ReviewResponseDto } from './dto/review-response.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';
import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';
import { REVIEW_BULK_SCHEDULE_MAX } from './reviews.constants.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly repo: Repository<Review>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    await this.assertEnrolmentMatch(
      user.organisationId!,
      dto.enrolmentId,
      dto.apprenticeId,
    );
    const entity = this.repo.create({
      organisationId: user.organisationId!,
      enrolmentId: dto.enrolmentId,
      apprenticeId: dto.apprenticeId,
      scheduledAt: new Date(dto.scheduledAt),
      title: dto.title ?? null,
      reviewType: dto.reviewType ?? null,
      status: ReviewStatus.SCHEDULED,
      isOverdue: false,
      overdueSince: null,
      apprenticeUserId: dto.apprenticeUserId,
      tutorUserId: dto.tutorUserId,
      employerManagerUserId: dto.employerManagerUserId,
    });
    return this.toResponse(await this.repo.save(entity));
  }

  async bulkSchedule(
    user: AuthenticatedUser,
    items: CreateReviewDto[],
  ): Promise<BulkScheduleReviewsResponseDto> {
    if (items.length > REVIEW_BULK_SCHEDULE_MAX) {
      throw new BadRequestException(
        `Bulk schedule supports at most ${REVIEW_BULK_SCHEDULE_MAX} items`,
      );
    }

    const reviews: ReviewResponseDto[] = [];
    const failures: BulkScheduleReviewsResponseDto['failures'] = [];

    for (let index = 0; index < items.length; index++) {
      try {
        reviews.push(await this.create(user, items[index]));
      } catch (error) {
        failures.push({
          index,
          reasonCode:
            error instanceof BadRequestException
              ? 'validation_error'
              : 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      processed: items.length,
      succeeded: reviews.length,
      failed: failures.length,
      reviews,
      failures,
    };
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListReviewsQueryDto,
  ): Promise<PaginatedResult<ReviewResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const qb = this.repo
      .createQueryBuilder('review')
      .where('review.organisationId = :organisationId', {
        organisationId: user.organisationId!,
      })
      .andWhere('review.isDeleted = false');

    if (query.status)
      qb.andWhere('review.status = :status', { status: query.status });
    if (query.apprenticeId)
      qb.andWhere('review.apprenticeId = :apprenticeId', {
        apprenticeId: query.apprenticeId,
      });
    if (query.enrolmentId)
      qb.andWhere('review.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    if (query.isOverdue !== undefined)
      qb.andWhere('review.isOverdue = :isOverdue', {
        isOverdue: query.isOverdue,
      });
    if (query.from)
      qb.andWhere('review.scheduledAt >= :from', {
        from: new Date(query.from),
      });
    if (query.to)
      qb.andWhere('review.scheduledAt <= :to', { to: new Date(query.to) });

    qb.orderBy('review.scheduledAt', 'ASC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ReviewResponseDto> {
    const row = await this.findEntity(user, id);
    return this.toResponse(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    const row = await this.findEntity(user, id);

    if (dto.status === ReviewStatus.CANCELLED) {
      row.status = ReviewStatus.CANCELLED;
    } else if (
      row.status === ReviewStatus.COMPLETED ||
      row.status === ReviewStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot update a terminal review');
    }

    if (dto.scheduledAt !== undefined) {
      row.scheduledAt = new Date(dto.scheduledAt);
      if (row.status === ReviewStatus.SCHEDULED) {
        row.isOverdue = false;
        row.overdueSince = null;
      }
    }
    if (dto.title !== undefined) row.title = dto.title;
    if (dto.reviewType !== undefined) row.reviewType = dto.reviewType;
    if (dto.apprenticeUserId !== undefined)
      row.apprenticeUserId = dto.apprenticeUserId;
    if (dto.tutorUserId !== undefined) row.tutorUserId = dto.tutorUserId;
    if (dto.employerManagerUserId !== undefined)
      row.employerManagerUserId = dto.employerManagerUserId;

    if (
      dto.status !== undefined &&
      dto.status !== ReviewStatus.CANCELLED &&
      row.status === ReviewStatus.SCHEDULED
    ) {
      row.status = dto.status;
    }

    const saved = await this.repo.save(row);
    if (saved.status === ReviewStatus.COMPLETED) {
      await this.eifScoreCache.invalidate(user.organisationId!);
    }
    return this.toResponse(saved);
  }

  async findEntity(user: AuthenticatedUser, id: string): Promise<Review> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('Review not found');
    return row;
  }

  private async assertEnrolmentMatch(
    organisationId: string,
    enrolmentId: string,
    apprenticeId: string,
  ): Promise<void> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new BadRequestException('Enrolment not found in organisation');
    }
    if (enrolment.apprenticeId !== apprenticeId) {
      throw new BadRequestException('Apprentice does not match enrolment');
    }
  }

  toResponse(entity: Review): ReviewResponseDto {
    const now = new Date();
    const scheduled = entity.scheduledAt;
    const msPerDay = 86_400_000;
    const daysUntilDue = Math.ceil(
      (scheduled.getTime() - now.getTime()) / msPerDay,
    );

    return {
      id: entity.id,
      organisationId: entity.organisationId,
      enrolmentId: entity.enrolmentId,
      apprenticeId: entity.apprenticeId,
      scheduledAt: entity.scheduledAt.toISOString(),
      title: entity.title,
      reviewType: entity.reviewType,
      status: entity.status,
      isOverdue: entity.isOverdue,
      overdueSince: entity.overdueSince,
      daysUntilDue,
      apprenticeUserId: entity.apprenticeUserId,
      tutorUserId: entity.tutorUserId,
      employerManagerUserId: entity.employerManagerUserId,
      snapshotPdfJobId: entity.snapshotPdfJobId,
      finalSignedPdfKey: entity.finalSignedPdfKey,
    };
  }
}
