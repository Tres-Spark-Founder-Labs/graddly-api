import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import {
  computeOtjPaceSnapshot,
  OTJ_AT_RISK_THRESHOLD_PERCENT,
  OTJ_OVERDUE_THRESHOLD_PERCENT,
  resolveAlertLevel,
} from './otj-pace-calculator.js';

describe('computeOtjPaceSnapshot', () => {
  it('returns on_track when approved minutes meet expected pace', () => {
    const snapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: 18,
      plannedStartDate: '2025-01-01',
      plannedEndDate: '2026-07-01',
      activatedAt: new Date('2025-01-01T00:00:00.000Z'),
      epaDate: '2026-07-01',
      approvedMinutes: 6500,
      asOf: new Date('2025-07-01T00:00:00.000Z'),
    });

    expect(snapshot.alertLevel).toBe(OtjPaceAlertLevel.ON_TRACK);
    expect(snapshot.behindPercent).not.toBeNull();
    expect((snapshot.behindPercent ?? 0) <= 15).toBe(true);
  });

  it('returns at_risk when more than 15% behind expected pace', () => {
    const snapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: 12,
      plannedStartDate: '2025-01-01',
      plannedEndDate: '2026-01-01',
      activatedAt: new Date('2025-01-01T00:00:00.000Z'),
      epaDate: '2026-01-01',
      approvedMinutes: 5500,
      asOf: new Date('2025-07-01T00:00:00.000Z'),
    });

    expect(snapshot.alertLevel).toBe(OtjPaceAlertLevel.AT_RISK);
    expect((snapshot.behindPercent ?? 0) > 15).toBe(true);
    expect((snapshot.behindPercent ?? 0) <= 30).toBe(true);
  });

  it('returns off_track when more than 30% behind expected pace', () => {
    const snapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: 12,
      plannedStartDate: '2025-01-01',
      plannedEndDate: '2026-01-01',
      activatedAt: new Date('2025-01-01T00:00:00.000Z'),
      epaDate: '2026-01-01',
      approvedMinutes: 100,
      asOf: new Date('2025-10-01T00:00:00.000Z'),
    });

    expect(snapshot.alertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
    expect((snapshot.behindPercent ?? 0) > 30).toBe(true);
  });
});

/**
 * F1.2.4 AC2 and AC3 specify the thresholds as "more than 15%" and "more than
 * 30%" behind. The three tests above confirm the bands but never touch the
 * boundaries, which is the only place the wording actually bites: at exactly
 * 15.0% behind, "more than 15" and "15 or more" disagree.
 */
describe('threshold boundaries', () => {
  it('exposes the thresholds the acceptance criteria name', () => {
    expect(OTJ_AT_RISK_THRESHOLD_PERCENT).toBe(15);
    expect(OTJ_OVERDUE_THRESHOLD_PERCENT).toBe(30);
  });

  it('treats exactly 15% behind as on track, not at risk', () => {
    expect(resolveAlertLevel(15)).toBe(OtjPaceAlertLevel.ON_TRACK);
  });

  it('flags at risk just past 15%', () => {
    expect(resolveAlertLevel(15.01)).toBe(OtjPaceAlertLevel.AT_RISK);
  });

  it('treats exactly 30% behind as at risk, not overdue', () => {
    expect(resolveAlertLevel(30)).toBe(OtjPaceAlertLevel.AT_RISK);
  });

  it('flags overdue just past 30%', () => {
    expect(resolveAlertLevel(30.01)).toBe(OtjPaceAlertLevel.OFF_TRACK);
  });

  it('treats being ahead of pace as on track', () => {
    // A negative "behind" percentage means ahead — it must not wrap into a
    // flag through a sign mistake.
    expect(resolveAlertLevel(-40)).toBe(OtjPaceAlertLevel.ON_TRACK);
  });

  it('returns no level when pace cannot be computed', () => {
    // Distinct from ON_TRACK: an enrolment with no dates is unknown, not fine.
    expect(resolveAlertLevel(null)).toBeNull();
  });
});

describe('required pace inputs (AC1)', () => {
  const base = {
    plannedDurationMonths: 12,
    plannedStartDate: '2025-01-01',
    plannedEndDate: '2026-01-01',
    activatedAt: new Date('2025-01-01T00:00:00.000Z'),
    epaDate: '2026-01-01',
    asOf: new Date('2025-07-01T00:00:00.000Z'),
  };

  it('derives the target from programme duration', () => {
    const snapshot = computeOtjPaceSnapshot({ ...base, approvedMinutes: 0 });
    expect(snapshot.totalTargetMinutes).toBeGreaterThan(0);
  });

  it('scales expected hours by elapsed time, not the whole programme', () => {
    // Halfway through, roughly half the target should be expected — otherwise
    // every apprentice is "behind" from day one.
    const snapshot = computeOtjPaceSnapshot({ ...base, approvedMinutes: 0 });
    const ratio = snapshot.expectedMinutesByToday / snapshot.totalTargetMinutes;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  it('cannot compute a pace without a duration', () => {
    const snapshot = computeOtjPaceSnapshot({
      ...base,
      plannedDurationMonths: null,
      approvedMinutes: 500,
    });
    expect(snapshot.alertLevel).toBeNull();
    expect(snapshot.behindPercent).toBeNull();
  });

  it('cannot compute a pace without an end date', () => {
    const snapshot = computeOtjPaceSnapshot({
      ...base,
      epaDate: null,
      plannedEndDate: null,
      approvedMinutes: 500,
    });
    expect(snapshot.alertLevel).toBeNull();
  });

  it('does not report being behind after the programme end date', () => {
    // Elapsed days are clamped to the programme length, so an overrunning
    // enrolment does not drift to an ever-worsening percentage.
    const onTime = computeOtjPaceSnapshot({
      ...base,
      approvedMinutes: 0,
      asOf: new Date('2026-01-01T00:00:00.000Z'),
    });
    const wayLate = computeOtjPaceSnapshot({
      ...base,
      approvedMinutes: 0,
      asOf: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(wayLate.behindPercent).toBe(onTime.behindPercent);
  });
});
