import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';

/**
 * Expected OTJ hours per month of programme duration — the 20% off-the-job
 * rule, expressed as a monthly baseline.
 *
 * P0-A moved this here from `reporting/otj-progress-metrics.service.ts`. It is
 * the single most fundamental constant in OTJ pace arithmetic, and this file
 * — the only place that arithmetic lives — was importing it *from* reporting,
 * which meant the domain rule was owned by a consumer of the domain. The
 * reporting service now imports it from here like every other consumer.
 */
export const OTJ_HOURS_PER_PLANNED_MONTH = 20;

export type OtjPaceSnapshot = {
  totalTargetMinutes: number;
  expectedMinutesByToday: number;
  approvedMinutes: number;
  behindPercent: number | null;
  alertLevel: OtjPaceAlertLevel | null;
  requiredWeeklyHours: number | null;
};

/**
 * D2 — the learner-facing minute breakdown.
 *
 * Four components, never a merged total. The client decided that approved
 * minutes are the authoritative figure and pending minutes are displayed
 * separately, so a combined field would have no consumer and would only invite
 * one.
 *
 * `loggedMinutes` is every non-deleted entry at any status, drafts included.
 * That makes draft minutes derivable —
 * `loggedMinutes - pendingMinutes - approvedMinutes - rejectedMinutes` — so the
 * four figures reconcile without a fifth field.
 *
 * REJECTED MINUTES, stated explicitly rather than left implicit: they are
 * counted in `loggedMinutes` and excluded from both `pendingMinutes` and
 * `approvedMinutes`, and they are exposed on their own so a consumer can show
 * "sent back" work without inferring it from a subtraction.
 */
export type OtjMinutesBreakdown = {
  loggedMinutes: number;
  pendingMinutes: number;
  approvedMinutes: number;
  rejectedMinutes: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * F1.2.4 AC2 — "at-risk flag triggers when actual OTJ pace falls more than 15%
 * behind required pace".
 *
 * Strictly "more than": exactly 15% behind is still on track. Exported so the
 * alert email, the tests and the UI copy all quote the same number rather than
 * three independently maintained literals.
 */
export const OTJ_AT_RISK_THRESHOLD_PERCENT = 15;

/** F1.2.4 AC3 — overdue at more than 30% behind. */
export const OTJ_OVERDUE_THRESHOLD_PERCENT = 30;

export function computeOtjPaceSnapshot(input: {
  plannedDurationMonths: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  activatedAt: Date | null;
  epaDate: string | null;
  approvedMinutes: number;
  asOf?: Date;
}): OtjPaceSnapshot {
  const months = input.plannedDurationMonths;
  if (!months || months <= 0) {
    return emptySnapshot(input.approvedMinutes);
  }

  const totalTargetMinutes = months * OTJ_HOURS_PER_PLANNED_MONTH * 60;
  const start = resolveStartDate(input);
  const end = resolveEndDate(input);
  if (!start || !end || end.getTime() <= start.getTime()) {
    return {
      ...emptySnapshot(input.approvedMinutes),
      totalTargetMinutes,
    };
  }

  const asOf = input.asOf ?? new Date();
  const totalDays = daysBetween(start, end);
  const elapsedDays = Math.min(
    Math.max(daysBetween(start, asOf), 0),
    totalDays,
  );
  const expectedMinutesByToday =
    totalDays > 0
      ? (totalTargetMinutes * elapsedDays) / totalDays
      : totalTargetMinutes;

  const behindPercent =
    expectedMinutesByToday > 0
      ? ((expectedMinutesByToday - input.approvedMinutes) /
          expectedMinutesByToday) *
        100
      : null;

  const alertLevel = resolveAlertLevel(behindPercent);
  const remainingWeeks = Math.max(
    Math.ceil((end.getTime() - asOf.getTime()) / (7 * MS_PER_DAY)),
    1,
  );
  const remainingMinutes = Math.max(
    totalTargetMinutes - input.approvedMinutes,
    0,
  );
  const requiredWeeklyHours = Number(
    (remainingMinutes / 60 / remainingWeeks).toFixed(2),
  );

  return {
    totalTargetMinutes,
    expectedMinutesByToday: Number(expectedMinutesByToday.toFixed(2)),
    approvedMinutes: input.approvedMinutes,
    behindPercent:
      behindPercent === null ? null : Number(behindPercent.toFixed(2)),
    alertLevel,
    requiredWeeklyHours,
  };
}

/**
 * The threshold rule, exported so the boundaries can be tested directly.
 *
 * Constructing programme dates that land on exactly 15.00% behind is possible
 * but fragile, and a test that cannot reach the boundary cannot show which
 * side of it the rule falls on — which is the only thing AC2 and AC3 actually
 * specify.
 */
/**
 * Percentage of the programme's total OTJ target that has been **approved**.
 *
 * Distinct from `behindPercent`, which measures the gap against what should
 * have been done *by today*. Both are needed and they are not interchangeable:
 * a learner three months into a two-year programme can be at 12% of target and
 * perfectly on track.
 *
 * Moved here from `OtjProgressMetricsService.computePercentForEnrolment` in
 * P0-A. It shared `months * OTJ_HOURS_PER_PLANNED_MONTH * 60` with
 * `computeOtjPaceSnapshot` above — the same target arithmetic maintained in two
 * files.
 *
 * Approved only, per D2: the thresholds and the headline both evaluate on
 * evidenced training, and a percentage padded with unapproved hours would let a
 * learner look compliant when they are not.
 *
 * `null` when the programme has no planned duration — unknown, not zero.
 */
export function computeOtjPercentOfTarget(
  plannedDurationMonths: number | null,
  approvedMinutes: number,
): number | null {
  if (!plannedDurationMonths || plannedDurationMonths <= 0) {
    return null;
  }

  const expectedMinutes =
    plannedDurationMonths * OTJ_HOURS_PER_PLANNED_MONTH * 60;
  if (expectedMinutes <= 0) {
    return null;
  }

  const percent = (approvedMinutes / expectedMinutes) * 100;
  return Number(Math.min(percent, 100).toFixed(2));
}

export function resolveAlertLevel(
  behindPercent: number | null,
): OtjPaceAlertLevel | null {
  if (behindPercent === null) {
    return null;
  }
  if (behindPercent > OTJ_OVERDUE_THRESHOLD_PERCENT) {
    return OtjPaceAlertLevel.OFF_TRACK;
  }
  if (behindPercent > OTJ_AT_RISK_THRESHOLD_PERCENT) {
    return OtjPaceAlertLevel.AT_RISK;
  }
  return OtjPaceAlertLevel.ON_TRACK;
}

function resolveStartDate(input: {
  plannedStartDate: string | null;
  activatedAt: Date | null;
}): Date | null {
  if (input.plannedStartDate) {
    return parseDate(input.plannedStartDate);
  }
  return input.activatedAt ?? null;
}

function resolveEndDate(input: {
  epaDate: string | null;
  plannedEndDate: string | null;
}): Date | null {
  if (input.epaDate) {
    return parseDate(input.epaDate);
  }
  if (input.plannedEndDate) {
    return parseDate(input.plannedEndDate);
  }
  return null;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY), 1);
}

function emptySnapshot(approvedMinutes: number): OtjPaceSnapshot {
  return {
    totalTargetMinutes: 0,
    expectedMinutesByToday: 0,
    approvedMinutes,
    behindPercent: null,
    alertLevel: null,
    requiredWeeklyHours: null,
  };
}
