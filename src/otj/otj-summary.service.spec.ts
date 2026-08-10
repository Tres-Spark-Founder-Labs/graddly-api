import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import {
  OTJ_AT_RISK_THRESHOLD_PERCENT,
  OTJ_HOURS_PER_PLANNED_MONTH,
  OTJ_OVERDUE_THRESHOLD_PERCENT,
  resolveAlertLevel,
} from './otj-pace-calculator.js';
import { OtjSummaryService } from './otj-summary.service.js';

import type { Enrolment } from '../enrolments/entities/enrolment.entity.js';

/**
 * P0-A. The arithmetic now exists in exactly one place, so this is the one
 * place it is proven.
 */
describe('OtjSummaryService', () => {
  let service: OtjSummaryService;
  const getRawOne = jest.fn();
  const getRawMany = jest.fn();

  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne,
    getRawMany,
  };

  /** pg returns SUM() as a string; the mock does too, so coercion is covered. */
  const sums = (over: Partial<Record<string, number>> = {}) => ({
    logged: String(over.logged ?? 0),
    pending: String(over.pending ?? 0),
    approved: String(over.approved ?? 0),
    rejected: String(over.rejected ?? 0),
  });

  /** A twelve-month programme: 12 × 20 h × 60 = 14,400 target minutes. */
  const enrolment = (over: Partial<Enrolment> = {}) =>
    ({
      id: 'enr-1',
      plannedDurationMonths: 12,
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2027-01-01',
      activatedAt: new Date('2026-01-01T00:00:00.000Z'),
      epaDate: '2027-01-01',
      ...over,
    }) as Enrolment;

  beforeEach(async () => {
    jest.clearAllMocks();
    getRawOne.mockResolvedValue(sums());
    getRawMany.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjSummaryService,
        {
          provide: getRepositoryToken(OtjLogEntry),
          useValue: { createQueryBuilder: () => qb },
        },
      ],
    }).compile();

    service = moduleRef.get(OtjSummaryService);
  });

  describe('minutesForEnrolment', () => {
    it('returns zeros when nothing has been logged', async () => {
      await expect(service.minutesForEnrolment('enr-1')).resolves.toEqual({
        loggedMinutes: 0,
        pendingMinutes: 0,
        approvedMinutes: 0,
        rejectedMinutes: 0,
      });
    });

    it('returns all pending when nothing is approved yet', async () => {
      getRawOne.mockResolvedValue(sums({ logged: 300, pending: 300 }));

      await expect(service.minutesForEnrolment('enr-1')).resolves.toEqual({
        loggedMinutes: 300,
        pendingMinutes: 300,
        approvedMinutes: 0,
        rejectedMinutes: 0,
      });
    });

    it('returns all approved when everything has been signed off', async () => {
      getRawOne.mockResolvedValue(sums({ logged: 300, approved: 300 }));

      await expect(service.minutesForEnrolment('enr-1')).resolves.toEqual({
        loggedMinutes: 300,
        pendingMinutes: 0,
        approvedMinutes: 300,
        rejectedMinutes: 0,
      });
    });

    /**
     * The reconciliation the DTO documents: drafts are in `loggedMinutes` and
     * nowhere else, so subtracting the other three yields them.
     */
    it('keeps rejected separate and leaves drafts derivable', async () => {
      getRawOne.mockResolvedValue(
        sums({ logged: 600, pending: 120, approved: 300, rejected: 60 }),
      );

      const result = await service.minutesForEnrolment('enr-1');

      expect(result).toEqual({
        loggedMinutes: 600,
        pendingMinutes: 120,
        approvedMinutes: 300,
        rejectedMinutes: 60,
      });

      const draftMinutes =
        result.loggedMinutes -
        result.pendingMinutes -
        result.approvedMinutes -
        result.rejectedMinutes;
      expect(draftMinutes).toBe(120);
    });

    it('coerces a missing row to zeros rather than NaN', async () => {
      getRawOne.mockResolvedValue(undefined);

      await expect(service.minutesForEnrolment('enr-1')).resolves.toEqual({
        loggedMinutes: 0,
        pendingMinutes: 0,
        approvedMinutes: 0,
        rejectedMinutes: 0,
      });
    });
  });

  describe('percentage of target', () => {
    it('is null when the programme has no planned duration', async () => {
      getRawOne.mockResolvedValue(sums({ logged: 600, approved: 600 }));

      // Unknown, never zero. A 0 renders as "you have logged nothing".
      await expect(
        service.percentForEnrolment(enrolment({ plannedDurationMonths: null })),
      ).resolves.toBeNull();
    });

    it('is approved-only, per D2', async () => {
      // 1,440 approved of 14,400 target = 10%. Pending is excluded.
      getRawOne.mockResolvedValue(
        sums({ logged: 14400, pending: 12960, approved: 1440 }),
      );

      await expect(service.percentForEnrolment(enrolment())).resolves.toBe(10);
    });

    it('caps at 100 rather than reporting over-achievement', async () => {
      getRawOne.mockResolvedValue(sums({ logged: 99999, approved: 99999 }));

      await expect(service.percentForEnrolment(enrolment())).resolves.toBe(100);
    });

    it('uses the shared monthly baseline constant', () => {
      // Guards the constant against a silent edit: 12 months × 20 h × 60 min.
      expect(12 * OTJ_HOURS_PER_PLANNED_MONTH * 60).toBe(14400);
    });
  });

  describe('threshold evaluation', () => {
    /**
     * Both sides of both thresholds, asserted on the rule directly.
     *
     * Constructing programme dates that land on exactly 15.00% behind is
     * possible but fragile, and a test that cannot reach the boundary cannot
     * show which side of it the rule falls on — which is the only thing AC2 and
     * AC3 actually specify. The rule is "strictly more than".
     */
    it.each([
      [0, OtjPaceAlertLevel.ON_TRACK],
      [OTJ_AT_RISK_THRESHOLD_PERCENT, OtjPaceAlertLevel.ON_TRACK],
      [OTJ_AT_RISK_THRESHOLD_PERCENT + 0.01, OtjPaceAlertLevel.AT_RISK],
      [OTJ_OVERDUE_THRESHOLD_PERCENT, OtjPaceAlertLevel.AT_RISK],
      [OTJ_OVERDUE_THRESHOLD_PERCENT + 0.01, OtjPaceAlertLevel.OFF_TRACK],
    ])('%s%% behind resolves to %s', (behindPercent, expected) => {
      expect(resolveAlertLevel(behindPercent)).toBe(expected);
    });

    it('is null when the gap cannot be known', () => {
      expect(resolveAlertLevel(null)).toBeNull();
    });

    /**
     * D2, and the reason `pendingMinutes` is returned alongside the evaluated
     * state rather than folded into it: a learner whose pending hours would
     * have cleared the threshold is not behind on training, they are waiting on
     * their provider. F3.1.4 branches its message on exactly this.
     */
    it('evaluates the threshold on approved minutes while still reporting pending', async () => {
      // Nine months into a twelve-month programme: 10,800 minutes expected.
      // 1,440 approved is 86.7% behind — off track. But 10,000 more sit
      // pending, which would have cleared it.
      getRawOne.mockResolvedValue(
        sums({ logged: 11440, pending: 10000, approved: 1440 }),
      );

      const pace = await service.paceForEnrolment(enrolment(), {
        asOf: new Date('2026-10-01T00:00:00.000Z'),
      });

      expect(pace.alertLevel).toBe(OtjPaceAlertLevel.OFF_TRACK);
      expect(pace.approvedMinutes).toBe(1440);
      expect(pace.pendingMinutes).toBe(10000);
    });
  });

  describe('paceForEnrolment', () => {
    it('returns the minutes, the percentage and the evaluated state together', async () => {
      getRawOne.mockResolvedValue(
        sums({ logged: 8000, pending: 600, approved: 7200, rejected: 200 }),
      );

      const pace = await service.paceForEnrolment(enrolment(), {
        asOf: new Date('2026-07-01T00:00:00.000Z'),
      });

      expect(pace.loggedMinutes).toBe(8000);
      expect(pace.pendingMinutes).toBe(600);
      expect(pace.approvedMinutes).toBe(7200);
      expect(pace.rejectedMinutes).toBe(200);
      expect(pace.otjPercent).toBe(50);
      expect(pace.totalTargetMinutes).toBe(14400);
      expect(pace.alertLevel).toBe(OtjPaceAlertLevel.ON_TRACK);
    });
  });

  describe('averagePercentForEnrolments', () => {
    it('is null for an empty cohort', async () => {
      await expect(service.averagePercentForEnrolments([])).resolves.toBeNull();
    });

    it('averages only the enrolments whose percentage is knowable', async () => {
      getRawMany.mockResolvedValue([
        { enrolmentId: 'a', approvedMinutes: '14400' }, // 100%
        { enrolmentId: 'b', approvedMinutes: '7200' }, //  50%
        { enrolmentId: 'c', approvedMinutes: '7200' }, //  unknown duration
      ]);

      const average = await service.averagePercentForEnrolments([
        enrolment({ id: 'a' }),
        enrolment({ id: 'b' }),
        enrolment({ id: 'c', plannedDurationMonths: null }),
      ]);

      // (100 + 50) / 2 — the unknown contributes nothing rather than a zero
      // that would drag a provider's figure down for a data-entry gap.
      expect(average).toBe(75);
    });

    it('is null when no enrolment has a knowable percentage', async () => {
      await expect(
        service.averagePercentForEnrolments([
          enrolment({ id: 'a', plannedDurationMonths: null }),
        ]),
      ).resolves.toBeNull();
    });
  });
});
