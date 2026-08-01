import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
import { EpaOutcome } from '../enrolments/enums/epa-outcome.enum.js';

/**
 * A pass is any graded outcome that is not a fail.
 *
 * Merit and distinction are pass grades, not separate results — an
 * apprenticeship "pass rate" that counted only `PASS` would report a
 * high-performing cohort as failing, which is the opposite of the truth.
 */
const PASSING_OUTCOMES: ReadonlySet<EpaOutcome> = new Set([
  EpaOutcome.PASS,
  EpaOutcome.MERIT,
  EpaOutcome.DISTINCTION,
]);

export interface IEpaPassRateResult {
  /** Percentage, or null when nothing has been assessed yet. */
  passRate: number | null;
  assessedCount: number;
  passCount: number;
}

const EMPTY: IEpaPassRateResult = {
  passRate: null,
  assessedCount: 0,
  passCount: 0,
};

/**
 * F1.4.1 AC1 — "ROI report includes … EPA pass rate".
 *
 * The report returned a hardcoded `null` with the comment *"Reserved until EPA
 * outcomes entity exists"*. That entity does exist: `epa_outcomes`, written by
 * `EnrolmentsService.recordEpaOutcome`, with a `pass | merit | distinction |
 * fail` enum and an `assessedOn` date. The blocker was removed and the stub
 * outlived it — in the DTO, in the PDF renderer, and in the employer UI, all
 * three still saying the data is unavailable.
 *
 * **Scoped by enrolment, not by organisation.** `epa_outcomes.organisationId`
 * is stamped with whoever recorded the outcome, and end-point assessment is
 * arranged by the training provider — so an employer-scoped query returns
 * nothing for exactly the apprentices the employer is reporting on. Filtering
 * by enrolment id is what makes this the employer's data. The enrolments are
 * already authorised by the caller before they reach here.
 */
@Injectable()
export class EpaOutcomeMetricsService {
  constructor(
    @InjectRepository(EpaOutcomeRecord)
    private readonly epaOutcomeRepo: Repository<EpaOutcomeRecord>,
  ) {}

  async passRateForEnrolments(
    enrolmentIds: string[],
    options: { from?: Date; to?: Date } = {},
  ): Promise<IEpaPassRateResult> {
    if (enrolmentIds.length === 0) {
      return EMPTY;
    }

    const records = await this.epaOutcomeRepo.find({
      where: { enrolmentId: In(enrolmentIds), isDeleted: false },
      select: ['outcome', 'assessedOn'],
    });

    /**
     * `assessedOn` is a `date` column, so TypeORM hands back a `YYYY-MM-DD`
     * string rather than a Date. Filtering in JS keeps the year-on-year
     * windowing in one place instead of threading date predicates through
     * every caller, and the row counts here are per-employer, not global.
     */
    const inWindow = records.filter((record) =>
      this.isWithin(record.assessedOn, options.from, options.to),
    );

    if (inWindow.length === 0) {
      return EMPTY;
    }

    const passCount = inWindow.filter((record) =>
      PASSING_OUTCOMES.has(record.outcome),
    ).length;

    return {
      passRate: Number(((passCount / inWindow.length) * 100).toFixed(2)),
      assessedCount: inWindow.length,
      passCount,
    };
  }

  private isWithin(assessedOn: string, from?: Date, to?: Date): boolean {
    if (!from && !to) {
      return true;
    }
    // Compare as calendar dates. Parsing to a Date would apply the server's
    // timezone to a value that has none, moving assessments across a year
    // boundary for anyone east or west of UTC.
    const day = assessedOn.slice(0, 10);
    if (from && day < this.toDay(from)) {
      return false;
    }
    if (to && day > this.toDay(to)) {
      return false;
    }
    return true;
  }

  private toDay(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
