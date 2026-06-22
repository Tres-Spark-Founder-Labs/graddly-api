import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';

@Injectable()
export class ReviewsOverdueService {
  constructor(
    @InjectRepository(Review)
    private readonly repo: Repository<Review>,
  ) {}

  /** Flags overdue reviews without user audit context (cron-safe). */
  async flagOverdueReviews(): Promise<number> {
    const overdueThreshold = new Date();
    overdueThreshold.setUTCDate(overdueThreshold.getUTCDate() - 3);

    const result = await this.repo
      .createQueryBuilder()
      .update(Review)
      .set({
        isOverdue: true,
        overdueSince: () =>
          `COALESCE("overdueSince", (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)`,
      })
      .where('"status" = :status', { status: ReviewStatus.SCHEDULED })
      .andWhere('"isOverdue" = false')
      .andWhere('"scheduledAt" < :overdueThreshold', { overdueThreshold })
      .andWhere('"isDeleted" = false')
      .execute();

    return result.affected ?? 0;
  }
}
