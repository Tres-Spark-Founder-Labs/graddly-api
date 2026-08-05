import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';

import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';

@Injectable()
export class ReviewsOverdueService {
  constructor(
    @InjectRepository(Review)
    private readonly repo: Repository<Review>,
  ) {}

  /**
   * Flags overdue reviews without user audit context.
   *
   * Security hardening pass, item 7 — this comment used to end "(cron-safe)".
   * It was not. Running without user context is only half the problem: with no
   * `app.current_org` either, the `reviews_update` policy matched nothing and
   * this bulk UPDATE affected **zero rows on every run**. No review was ever
   * flagged overdue, and `result.affected` returned 0 as a clean answer.
   *
   * That mislabel is the same trap as the caseload-alert bug — a comment
   * describing intended behaviour sitting directly above the break.
   *
   * Bootstrap is correct here rather than per-organisation context: overdue is
   * a platform-wide, purely time-based sweep with no per-tenant phase.
   */
  async flagOverdueReviews(): Promise<number> {
    const overdueThreshold = new Date();
    overdueThreshold.setUTCDate(overdueThreshold.getUTCDate() - 3);

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return await this.flagOverdueReviewsScoped(overdueThreshold);
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async flagOverdueReviewsScoped(
    overdueThreshold: Date,
  ): Promise<number> {
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
