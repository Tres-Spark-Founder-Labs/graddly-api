import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

/**
 * Review compliance and withdrawal rate, in one place.
 *
 * Both were private methods on `LevyRoiReportService`, written for F1.4.2's
 * employer-facing provider comparison. F2.1.3 needs the same two figures for
 * a *provider's* own self-assessment, and two implementations of "what
 * fraction of our reviews happened on time" is exactly the kind of drift that
 * ends with an employer's dashboard and a provider's SAR disagreeing about
 * the same organisation.
 *
 * Extracted rather than copied, with the semantics unchanged — the F1.4.2
 * tests still pin the employer-side numbers.
 */
@Injectable()
export class LearnerOutcomeMetricsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
  ) {}

  /**
   * % of reviews scheduled up to now that reached `completed` status.
   *
   * `null`, not zero, when nothing is due yet. A provider whose first reviews
   * fall next month has not achieved 0% compliance — they have no compliance
   * figure, and printing 0% on a self-assessment would be a false confession.
   */
  async reviewComplianceRate(
    organisationId: string,
    enrolmentIds: string[],
  ): Promise<number | null> {
    if (enrolmentIds.length === 0) {
      return null;
    }

    const dueReviews = await this.reviewRepo.find({
      where: {
        organisationId,
        enrolmentId: In(enrolmentIds),
        isDeleted: false,
      },
      select: ['status', 'scheduledAt'],
    });

    const now = new Date();
    const due = dueReviews.filter((r) => r.scheduledAt <= now);
    if (due.length === 0) {
      return null;
    }
    const compliant = due.filter(
      (r) => r.status === ReviewStatus.COMPLETED,
    ).length;
    return Number(((compliant / due.length) * 100).toFixed(2));
  }

  /**
   * % of the group's enrolments (any status) withdrawn or cancelled.
   *
   * Counts a cancelled enrolment *or* a withdrawn apprentice: the two are
   * recorded separately and a learner who leaves shows up as one or the
   * other depending on which end of the process caught it first.
   */
  withdrawalRate(enrolments: Enrolment[]): number | null {
    if (enrolments.length === 0) {
      return null;
    }
    const withdrawn = enrolments.filter((e) => this.isWithdrawn(e)).length;
    return Number(((withdrawn / enrolments.length) * 100).toFixed(2));
  }

  /** Headcount by outcome, for the SAR's learner-outcome section. */
  countByOutcome(enrolments: Enrolment[]): {
    activeCount: number;
    completedCount: number;
    withdrawnCount: number;
  } {
    return {
      activeCount: enrolments.filter((e) => e.status === EnrolmentStatus.ACTIVE)
        .length,
      completedCount: enrolments.filter(
        (e) => e.status === EnrolmentStatus.COMPLETED,
      ).length,
      withdrawnCount: enrolments.filter((e) => this.isWithdrawn(e)).length,
    };
  }

  private isWithdrawn(enrolment: Enrolment): boolean {
    return (
      enrolment.status === EnrolmentStatus.CANCELLED ||
      enrolment.apprentice?.status === ApprenticeStatus.WITHDRAWN
    );
  }
}
