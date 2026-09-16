import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';

import {
  OTJ_WEEKLY_MAX_WEEKS,
  buildWeeklyBuckets,
  startOfIsoWeek,
} from './otj-weekly-buckets.js';

/**
 * F1.2.2 AC3. The rules here are the apprentice portal's
 * (`apps/apprentice/features/journey/utils/weekly-hours.js`), asserted on the
 * server so the two charts cannot drift apart.
 */
describe('otj weekly buckets', () => {
  // 2026-09-16 is a Wednesday; its ISO week starts Monday 2026-09-14.
  const today = new Date('2026-09-16T10:30:00.000Z');

  describe('startOfIsoWeek', () => {
    it('is the Monday of the week, at midnight UTC', () => {
      expect(startOfIsoWeek(today).toISOString()).toBe(
        '2026-09-14T00:00:00.000Z',
      );
    });

    it('treats Sunday as the last day of the week, not the first', () => {
      expect(
        startOfIsoWeek(new Date('2026-09-20T23:00:00.000Z')).toISOString(),
      ).toBe('2026-09-14T00:00:00.000Z');
    });

    it('is a fixed point for a Monday', () => {
      expect(
        startOfIsoWeek(new Date('2026-09-14T00:00:00.000Z')).toISOString(),
      ).toBe('2026-09-14T00:00:00.000Z');
    });
  });

  describe('buildWeeklyBuckets', () => {
    /** D2: approved is authoritative, pending is separate, nothing is merged. */
    it('keeps approved and submitted minutes apart, and counts nothing else', () => {
      const { weeks } = buildWeeklyBuckets(
        [
          {
            weekStart: '2026-09-07',
            status: OtjLogStatus.APPROVED,
            minutes: '120',
          },
          {
            weekStart: '2026-09-07',
            status: OtjLogStatus.SUBMITTED,
            minutes: 45,
          },
        ],
        { programmeStart: null, today: new Date('2026-09-09T00:00:00.000Z') },
      );

      expect(weeks).toEqual([
        { weekStart: '2026-09-07', approvedMinutes: 120, pendingMinutes: 45 },
      ]);
    });

    it('fills every week in range with a real zero', () => {
      const { weeks } = buildWeeklyBuckets(
        [
          {
            weekStart: '2026-08-24',
            status: OtjLogStatus.APPROVED,
            minutes: 60,
          },
          {
            weekStart: '2026-09-14',
            status: OtjLogStatus.APPROVED,
            minutes: 30,
          },
        ],
        { programmeStart: null, today },
      );

      expect(weeks.map((w) => w.weekStart)).toEqual([
        '2026-08-24',
        '2026-08-31',
        '2026-09-07',
        '2026-09-14',
      ]);
      expect(weeks[1]).toEqual({
        weekStart: '2026-08-31',
        approvedMinutes: 0,
        pendingMinutes: 0,
      });
    });

    it('starts at the programme start when that is earlier than the first entry', () => {
      const { weeks } = buildWeeklyBuckets(
        [
          {
            weekStart: '2026-09-14',
            status: OtjLogStatus.APPROVED,
            minutes: 30,
          },
        ],
        { programmeStart: '2026-09-02', today },
      );

      // 2026-09-02 is a Wednesday; its week starts 2026-08-31.
      expect(weeks.map((w) => w.weekStart)).toEqual([
        '2026-08-31',
        '2026-09-07',
        '2026-09-14',
      ]);
    });

    it('runs to this week even when the last entry is older', () => {
      const { weeks } = buildWeeklyBuckets(
        [
          {
            weekStart: '2026-08-31',
            status: OtjLogStatus.APPROVED,
            minutes: 30,
          },
        ],
        { programmeStart: null, today },
      );

      expect(weeks.map((w) => w.weekStart)).toEqual([
        '2026-08-31',
        '2026-09-07',
        '2026-09-14',
      ]);
    });

    it('has no weeks for a programme with no start date and no entries', () => {
      expect(buildWeeklyBuckets([], { programmeStart: null, today })).toEqual({
        weeks: [],
        truncated: false,
      });
    });

    it('says so when the range exceeds the cap, rather than quietly starting late', () => {
      const { weeks, truncated } = buildWeeklyBuckets([], {
        programmeStart: '2000-01-03',
        today,
      });

      expect(truncated).toBe(true);
      expect(weeks).toHaveLength(OTJ_WEEKLY_MAX_WEEKS);
      expect(weeks[weeks.length - 1].weekStart).toBe('2026-09-14');
    });

    it('ignores a row whose week cannot be parsed rather than inventing one', () => {
      const { weeks } = buildWeeklyBuckets(
        [
          {
            weekStart: 'not-a-date',
            status: OtjLogStatus.APPROVED,
            minutes: 60,
          },
          {
            weekStart: '2026-09-14',
            status: OtjLogStatus.APPROVED,
            minutes: 30,
          },
        ],
        { programmeStart: null, today },
      );

      expect(weeks).toEqual([
        { weekStart: '2026-09-14', approvedMinutes: 30, pendingMinutes: 0 },
      ]);
    });
  });
});
