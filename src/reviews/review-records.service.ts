import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { ReviewRecordResponseDto } from './dto/review-record-response.dto.js';
import { UpsertReviewRecordDto } from './dto/upsert-review-record.dto.js';
import { ReviewRecord } from './entities/review-record.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';

import type { ReviewRecordPayloadDto } from './dto/review-record-payload.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ReviewRecordsService {
  constructor(
    @InjectRepository(ReviewRecord)
    private readonly recordRepo: Repository<ReviewRecord>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
  ) {}

  async upsert(
    user: AuthenticatedUser,
    reviewId: string,
    dto: UpsertReviewRecordDto,
  ): Promise<ReviewRecordResponseDto> {
    const review = await this.findReview(user, reviewId);
    if (review.status === ReviewStatus.COMPLETED) {
      throw new BadRequestException('Cannot update record on completed review');
    }
    if (review.status === ReviewStatus.CANCELLED) {
      throw new BadRequestException('Cannot update record on cancelled review');
    }

    let record = await this.recordRepo.findOne({
      where: { reviewId, organisationId: user.organisationId! },
    });

    if (!record) {
      record = this.recordRepo.create({
        organisationId: user.organisationId!,
        reviewId,
        payload: dto.payload as unknown as Record<string, unknown>,
        submittedAt: new Date(),
        submittedByUserId: user.id,
      });
    } else {
      record.payload = dto.payload as unknown as Record<string, unknown>;
      record.submittedAt = new Date();
      record.submittedByUserId = user.id;
    }

    await this.recordRepo.save(record);

    if (review.status === ReviewStatus.SCHEDULED) {
      review.status = ReviewStatus.IN_PROGRESS;
      await this.reviewRepo.save(review);
    }

    return this.toResponse(record);
  }

  /**
   * F2.2.3 AC4 — the SMART goals agreed at this enrolment's last completed
   * review, so the tutor can record progress against them rather than
   * retyping them from memory or a previous PDF.
   *
   * Returns an empty list for a first review; the caller shows nothing rather
   * than an error, because "no previous goals" is a normal state at the start
   * of an apprenticeship, not a failure.
   */
  async previousGoals(
    user: AuthenticatedUser,
    reviewId: string,
  ): Promise<{ objective: string }[]> {
    const review = await this.findReview(user, reviewId);

    const previous = await this.reviewRepo.findOne({
      where: {
        organisationId: user.organisationId!,
        enrolmentId: review.enrolmentId,
        status: ReviewStatus.COMPLETED,
        isDeleted: false,
        // Strictly earlier, so re-opening a record never offers its own goals.
        scheduledAt: LessThan(review.scheduledAt),
      },
      order: { scheduledAt: 'DESC' },
    });
    if (!previous) return [];

    const record = await this.recordRepo.findOne({
      where: { reviewId: previous.id, organisationId: user.organisationId! },
    });
    const goals = (record?.payload as { smartGoals?: { objective?: string }[] })
      ?.smartGoals;
    if (!Array.isArray(goals)) return [];

    return goals
      .map((g) => ({ objective: String(g?.objective ?? '').trim() }))
      .filter((g) => g.objective.length > 0);
  }

  /**
   * F2.2.3 AC6 — readable by the provider that owns it and by the employer on
   * the enrolment.
   *
   * `findReviewForReader` does the authorisation; the record is then fetched
   * by `reviewId` alone rather than by owning organisation, because the
   * record carries the provider's id and an employer would match nothing.
   */
  async findOne(
    user: AuthenticatedUser,
    reviewId: string,
  ): Promise<ReviewRecordResponseDto> {
    await this.findReviewForReader(user, reviewId);

    const record = await this.recordRepo.findOne({ where: { reviewId } });
    if (!record) {
      throw new NotFoundException('Review record not found');
    }
    return this.toResponse(record);
  }

  async getPayloadForPdf(
    organisationId: string,
    reviewId: string,
  ): Promise<{
    title: string | null;
    scheduledAt: Date;
    apprenticeName: string;
    payload: ReviewRecordPayloadDto | null;
  }> {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId, organisationId, isDeleted: false },
      relations: ['apprentice'],
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    const record = await this.recordRepo.findOne({
      where: { reviewId, organisationId },
    });
    const apprentice = review.apprentice;
    return {
      title: review.title,
      scheduledAt: review.scheduledAt,
      apprenticeName: apprentice
        ? `${apprentice.firstName} ${apprentice.lastName}`
        : 'Apprentice',
      payload: (record?.payload as unknown as ReviewRecordPayloadDto) ?? null,
    };
  }

  /**
   * Write paths: the owning (provider) organisation only.
   *
   * Kept strict deliberately. F2.2.3 AC6 widens *reading* to the linked
   * employer; it does not widen writing. A review is the provider's record of
   * a conversation, and the employer being able to see it must not become the
   * employer being able to edit it.
   */
  private async findReview(
    user: AuthenticatedUser,
    reviewId: string,
  ): Promise<Review> {
    const review = await this.reviewRepo.findOne({
      where: {
        id: reviewId,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
    });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  /**
   * F2.2.3 AC6 — read path, visible to the provider that owns the review and
   * to the employer on the enrolment.
   *
   * The organisation filter has to move from the review row to the enrolment,
   * because the review is stamped with the provider. Without this the
   * database policy added in 1781100000038 would permit the row and the query
   * would still exclude it — the eighth time an owner-scoped read has needed
   * both halves changed, not one.
   */
  private async findReviewForReader(
    user: AuthenticatedUser,
    reviewId: string,
  ): Promise<Review> {
    const orgId = user.organisationId!;
    const review = await this.reviewRepo
      .createQueryBuilder('review')
      .innerJoin('enrolments', 'e', 'e.id = review.enrolmentId')
      .where('review.id = :reviewId', { reviewId })
      .andWhere('review.isDeleted = false')
      .andWhere('e.isDeleted = false')
      .andWhere(
        '(review.organisationId = :orgId OR e."employerOrganisationId" = :orgId OR e."providerOrganisationId" = :orgId)',
        { orgId },
      )
      .getOne();

    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  private toResponse(record: ReviewRecord): ReviewRecordResponseDto {
    return {
      reviewId: record.reviewId,
      payload: record.payload as unknown as ReviewRecordResponseDto['payload'],
      submittedAt: record.submittedAt?.toISOString() ?? null,
      submittedByUserId: record.submittedByUserId,
    };
  }
}
