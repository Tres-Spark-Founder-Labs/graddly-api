import { EpaCountdownBand } from './enums/epa-countdown-band.enum.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * F3.2.3 AC2 — the EPA countdown colour bands, and the arithmetic behind them.
 *
 * Pure functions, no repository access, so the boundaries can be tested at the
 * exact day rather than approximately. This mirrors `otj-pace-calculator.ts`:
 * the rule lives in one place, and the service reads it rather than restating
 * it.
 *
 * ── WHY THE BOUNDARIES ARE NAMED CONSTANTS ───────────────────────────────────
 *
 * The PRD writes the bands as "green (>90 days) / amber (30–90 days) / red
 * (<30 days)", which does not describe a partition: days 90 and 30 each appear
 * in two bands, or in none, depending on how you read it. The client settled
 * this (decision Q4): 90 or more is green, 30 to 89 is amber, 29 or fewer is
 * red. Every boundary below is that decision, not an interpretation of the
 * PRD's prose, and each has a test pinned to both sides of it.
 */
export const EPA_COUNTDOWN_GREEN_MIN_DAYS = 90;
export const EPA_COUNTDOWN_AMBER_MIN_DAYS = 30;

/**
 * Whole days from today to the EPA date, both taken at UTC midnight so the
 * result is a count of calendar days and not a fraction of a day that varies
 * with the hour the request arrives. Negative once the date has passed.
 */
export function computeDaysToEpa(
  epaDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!epaDate) {
    return null;
  }
  const end = new Date(`${epaDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) {
    return null;
  }
  const today = new Date(now.getTime());
  today.setUTCHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / MS_PER_DAY);
}

export function computeEpaCountdownBand({
  epaDate,
  completedAt,
  now = new Date(),
}: {
  epaDate: string | null;
  completedAt: Date | null;
  now?: Date;
}): EpaCountdownBand {
  const days = computeDaysToEpa(epaDate, now);

  if (days === null) {
    return EpaCountdownBand.UNSET;
  }

  /**
   * Decision Q4b — a date in the past with no completion recorded is overdue,
   * not "very red". The distinction matters to the apprentice: red means the
   * assessment is close, overdue means the date went by and nothing was
   * recorded, which is a different conversation with a different owner.
   *
   * When completion *has* been recorded the countdown has no subject left. No
   * decision covers what to show there, so this keeps the prior behaviour
   * (red) rather than inventing a state, and the gap is recorded in
   * OPEN_QUESTIONS.md rather than settled here.
   */
  if (days < 0) {
    return completedAt ? EpaCountdownBand.RED : EpaCountdownBand.OVERDUE;
  }

  /**
   * Decision Q4a — the day of the EPA reads as red rather than as a countdown
   * of zero. `days === 0` falls through to red here, and `daysToEpa` is
   * published alongside the band so the client can say "today" instead of
   * printing the number.
   */
  if (days >= EPA_COUNTDOWN_GREEN_MIN_DAYS) {
    return EpaCountdownBand.GREEN;
  }
  if (days >= EPA_COUNTDOWN_AMBER_MIN_DAYS) {
    return EpaCountdownBand.AMBER;
  }
  return EpaCountdownBand.RED;
}
