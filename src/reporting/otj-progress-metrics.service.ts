import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import {
  computeOtjPercentOfTarget,
  OTJ_HOURS_PER_PLANNED_MONTH,
} from '../otj/otj-pace-calculator.js';
import { OtjSummaryService } from '../otj/otj-summary.service.js';

/**
 * Re-exported for the existing importers that reach for it here. It now *lives*
 * in `otj/otj-pace-calculator.ts` — the domain owns its own constant, rather
 * than the pace calculator importing it from a reporting service that itself
 * consumes the pace calculator.
 */
export { OTJ_HOURS_PER_PLANNED_MONTH };

/**
 * F1.4.2 — why the OTJ queries scope by enrolment and not organisation.
 *
 * `otj_log_entries.organisationId` is stamped with whoever logged the hours,
 * which is the apprentice. It is *not* the employer, and
 * `OtjLogEntriesService.loadEmployerEnrolmentIds` already exists precisely
 * because of that: the employer approval queue has to scope by enrolment id or
 * it returns nothing.
 *
 * These metrics did not. They filtered `entry."organisationId" = <employer>`,
 * matched no rows, and computed every enrolment's progress from zero approved
 * minutes — which the percentage function turns into **0%**, not null. So the
 * F1.4.2 provider comparison showed every provider at 0% average OTJ, in red,
 * including providers whose apprentices were fully on track. A confident wrong
 * number on the table an employer uses to judge providers.
 *
 * The enrolment id is the real scope key: an OTJ entry belongs to exactly one
 * enrolment, the caller has already resolved which enrolments it may see, and
 * row-level security remains the backstop underneath.
 */
@Injectable()
export class OtjProgressMetricsService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly otjSummary: OtjSummaryService,
  ) {}

  /**
   * P0-A — this class no longer counts minutes or computes percentages.
   *
   * It used to keep its own copy of both: a SUM query duplicating
   * `OtjPaceService.sumApprovedMinutes`, and a `computePercentForEnrolment`
   * duplicating the target arithmetic inside `computeOtjPaceSnapshot`. Two
   * implementations of one funding-relevant figure is how the 0%-average defect
   * described above happened in the first place.
   *
   * What remains here is the *reporting* concern — resolving which enrolments
   * an organisation may aggregate over. The arithmetic belongs to
   * `OtjSummaryService`.
   */
  async averageOtjPercentForEnrolments(
    organisationId: string,
    enrolmentIds: string[],
  ): Promise<number | null> {
    if (enrolmentIds.length === 0) {
      return null;
    }

    const enrolments = await this.enrolmentRepo.findBy({
      id: In(enrolmentIds),
      organisationId,
      isDeleted: false,
    });

    return this.otjSummary.averagePercentForEnrolments(enrolments);
  }

  /**
   * Pure arithmetic, delegated. Kept as a method rather than removed because
   * several callers hold this service and pass minutes they already have.
   */
  computePercentForEnrolment(
    enrolment: Pick<Enrolment, 'plannedDurationMonths'>,
    approvedMinutes: number,
  ): number | null {
    return computeOtjPercentOfTarget(
      enrolment.plannedDurationMonths,
      approvedMinutes,
    );
  }

  async percentForEnrolment(
    enrolment: Pick<Enrolment, 'id' | 'plannedDurationMonths'>,
  ): Promise<number | null> {
    return this.otjSummary.percentForEnrolment(enrolment);
  }

  async approvedMinutesForEnrolment(enrolmentId: string): Promise<number> {
    return this.otjSummary.approvedMinutesForEnrolment(enrolmentId);
  }
}
