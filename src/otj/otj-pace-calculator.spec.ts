import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import { computeOtjPaceSnapshot } from './otj-pace-calculator.js';

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
