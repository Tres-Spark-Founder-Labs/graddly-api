import { OtjProgressBand } from './enums/otj-progress-band.enum.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * F3.1.2 — the progress ring's colour bands and the projected completion date.
 *
 * Pure functions with no repository access, so the boundaries can be asserted
 * at the exact percentage. Same shape as `otj-pace-calculator.ts` and
 * `epa-countdown.ts`: the rule lives here once and the services read it.
 *
 * ── THE BOUNDARY READING, AND WHY IT IS AN ASSUMPTION ────────────────────────
 *
 * F3.1.2 AC2 says "green (>70% of target) / amber (50–70%) / red (<50%)". Taken
 * literally that is self-consistent — 70 sits in amber's inclusive range — but
 * it is the same ambiguous shape as the EPA countdown criterion, where the
 * client settled it the *other* way: "90 or more is green".
 *
 * This applies that precedent: **the boundary belongs to the higher band.** 70
 * is green, 50 is amber. It is recorded as an assumption rather than a
 * decision, because the client has not been asked about this specific
 * criterion. Changing it is a one-line change to the two constants below, and
 * the tests state both sides of each boundary explicitly so the change would be
 * visible rather than silent.
 */
export const OTJ_PROGRESS_GREEN_MIN_PERCENT = 70;
export const OTJ_PROGRESS_AMBER_MIN_PERCENT = 50;

/**
 * @param percentOfTarget approved minutes as a percentage of the total target,
 *   or null when no target could be computed.
 */
export function computeOtjProgressBand(
  percentOfTarget: number | null,
): OtjProgressBand {
  if (percentOfTarget === null || Number.isNaN(percentOfTarget)) {
    return OtjProgressBand.UNKNOWN;
  }
  if (percentOfTarget >= OTJ_PROGRESS_GREEN_MIN_PERCENT) {
    return OtjProgressBand.GREEN;
  }
  if (percentOfTarget >= OTJ_PROGRESS_AMBER_MIN_PERCENT) {
    return OtjProgressBand.AMBER;
  }
  return OtjProgressBand.RED;
}

/**
 * F3.1.2 AC5 — projected completion date at the learner's current logging
 * pace.
 *
 * Deliberately based on **observed** pace (approved minutes ÷ days elapsed),
 * not on the pace they are supposed to keep. A projection built from the
 * required rate would always land exactly on the planned end date, which tells
 * the apprentice nothing and would hide the very slippage this is meant to
 * surface.
 *
 * Returns null rather than a date in three cases, each of which is a real
 * "cannot say" and must not be rendered as a guess:
 *
 * - the programme has not started, so there is no elapsed time to divide by;
 * - nothing has been approved yet, so the observed rate is zero and the
 *   projection is infinite;
 * - the target is already met, so there is nothing left to project.
 */
export function computeProjectedCompletionDate({
  approvedMinutes,
  totalTargetMinutes,
  startDate,
  now = new Date(),
}: {
  approvedMinutes: number;
  totalTargetMinutes: number;
  startDate: Date | string | null;
  now?: Date;
}): string | null {
  if (!startDate || totalTargetMinutes <= 0) {
    return null;
  }

  const start =
    startDate instanceof Date
      ? startDate
      : new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const elapsedDays = Math.floor(
    (now.getTime() - start.getTime()) / MS_PER_DAY,
  );
  if (elapsedDays <= 0) {
    return null;
  }

  if (approvedMinutes <= 0) {
    return null;
  }

  const remainingMinutes = totalTargetMinutes - approvedMinutes;
  if (remainingMinutes <= 0) {
    return null;
  }

  const minutesPerDay = approvedMinutes / elapsedDays;
  const daysRemaining = Math.ceil(remainingMinutes / minutesPerDay);

  const projected = new Date(now.getTime() + daysRemaining * MS_PER_DAY);
  return projected.toISOString().slice(0, 10);
}
