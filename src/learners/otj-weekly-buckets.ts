import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';

/**
 * F1.2.2 AC3 — "OTJ hours chart showing weekly logged hours over the
 * programme lifetime".
 *
 * ── WHY THIS IS SERVER-SIDE ────────────────────────────────────────────────
 *
 * The profile aggregate caps OTJ entries at LEARNER_PROFILE_OTJ_LIMIT, so a
 * long programme is silently truncated, and raising the cap would only move
 * the problem: the client would then bucket thousands of rows in the browser.
 * The database groups; this module fills the gaps.
 *
 * ── THE CONVENTION, WHICH IS THE APPRENTICE PORTAL'S ───────────────────────
 *
 * `apps/apprentice/features/journey/utils/weekly-hours.js` already draws this
 * chart for the learner, and a second convention for the employer would put
 * two different numbers on two screens for the same week. So, the same rules:
 *
 *   - Weeks start on Monday, 00:00 UTC — the ISO week. `weekStart` is that
 *     Monday as YYYY-MM-DD.
 *   - Approved and pending minutes are kept apart (client decision D2).
 *     `approvedMinutes` is the authoritative figure; `pendingMinutes` is
 *     `submitted` time awaiting a decision, shown separately, never merged.
 *     `draft` and `rejected` entries are in neither.
 *   - Every week in range is present, so a week with no logging is a real
 *     zero rather than a gap that closes up — the gap is what an employer
 *     needs to see.
 *   - Minutes, not hours: the OTJ contract is integer minutes everywhere else
 *     and dividing is the client's job.
 *
 * The range is the programme lifetime: from the earlier of the planned start
 * and the first logged week, to the later of this week and the last logged
 * week. A programme with no start date and no entries has no weeks.
 */

/** Ten years. Apprenticeships run one to five; beyond this is bad data. */
export const OTJ_WEEKLY_MAX_WEEKS = 520;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface IOtjWeeklyRow {
  /** Monday of the ISO week, YYYY-MM-DD, as the database grouped it. */
  weekStart: string;
  status: OtjLogStatus;
  /** SUM() arrives from pg as a string. */
  minutes: number | string;
}

export interface IOtjWeeklyBucket {
  weekStart: string;
  approvedMinutes: number;
  pendingMinutes: number;
}

export interface IOtjWeeklyResult {
  weeks: IOtjWeeklyBucket[];
  /**
   * True when the range exceeded OTJ_WEEKLY_MAX_WEEKS and the oldest weeks
   * were dropped. Reported rather than hidden: a chart that quietly starts
   * late is the truncation this endpoint exists to replace.
   */
  truncated: boolean;
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function startOfIsoWeek(date: Date): Date {
  const monday = new Date(date.getTime());
  monday.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildWeeklyBuckets(
  rows: IOtjWeeklyRow[],
  options: { programmeStart: string | null; today: Date },
): IOtjWeeklyResult {
  const byWeek = new Map<string, IOtjWeeklyBucket>();
  for (const row of rows) {
    const week = parseDateOnly(row.weekStart);
    if (!week) continue;
    const key = isoDate(startOfIsoWeek(week));
    const bucket = byWeek.get(key) ?? {
      weekStart: key,
      approvedMinutes: 0,
      pendingMinutes: 0,
    };
    const minutes = Number(row.minutes) || 0;
    if (row.status === OtjLogStatus.APPROVED) {
      bucket.approvedMinutes += minutes;
    } else if (row.status === OtjLogStatus.SUBMITTED) {
      bucket.pendingMinutes += minutes;
    }
    byWeek.set(key, bucket);
  }

  const loggedWeeks = [...byWeek.keys()].sort();
  const start = parseDateOnly(options.programmeStart);
  const candidatesFrom = [
    start ? startOfIsoWeek(start) : null,
    loggedWeeks.length ? parseDateOnly(loggedWeeks[0]) : null,
  ].filter((d): d is Date => d !== null);
  if (candidatesFrom.length === 0) {
    return { weeks: [], truncated: false };
  }
  const candidatesTo = [
    startOfIsoWeek(options.today),
    loggedWeeks.length
      ? parseDateOnly(loggedWeeks[loggedWeeks.length - 1])
      : null,
  ].filter((d): d is Date => d !== null);

  let from = new Date(Math.min(...candidatesFrom.map((d) => d.getTime())));
  const to = new Date(Math.max(...candidatesTo.map((d) => d.getTime())));

  let truncated = false;
  const span = Math.round((to.getTime() - from.getTime()) / MS_PER_WEEK) + 1;
  if (span > OTJ_WEEKLY_MAX_WEEKS) {
    from = new Date(to.getTime() - (OTJ_WEEKLY_MAX_WEEKS - 1) * MS_PER_WEEK);
    truncated = true;
  }

  const weeks: IOtjWeeklyBucket[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_WEEK) {
    const key = isoDate(new Date(t));
    weeks.push(
      byWeek.get(key) ?? {
        weekStart: key,
        approvedMinutes: 0,
        pendingMinutes: 0,
      },
    );
  }
  return { weeks, truncated };
}
