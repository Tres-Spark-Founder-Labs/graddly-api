import { Test } from '@nestjs/testing';

import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';
import { LevyRoiYearOnYearService } from './levy-roi-year-on-year.service.js';

import type { Enrolment } from '../enrolments/entities/enrolment.entity.js';

/** Fixed "now" so the two 12-month windows are deterministic. */
const NOW = new Date('2026-07-01T00:00:00Z');
// Current window: 2025-07-01 → 2026-07-01. Prior: 2024-07-01 → 2025-07-01.

describe('LevyRoiYearOnYearService (F1.4.1 AC3)', () => {
  const monthlyService = { listRecentMonths: jest.fn() };
  const epaMetrics = { passRateForEnrolments: jest.fn() };
  let service: LevyRoiYearOnYearService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRoiYearOnYearService,
        { provide: DasLevyMonthlyService, useValue: monthlyService },
        { provide: EpaOutcomeMetricsService, useValue: epaMetrics },
      ],
    }).compile();

    service = moduleRef.get(LevyRoiYearOnYearService);
    jest.clearAllMocks();
    monthlyService.listRecentMonths.mockResolvedValue([]);
    epaMetrics.passRateForEnrolments.mockResolvedValue({
      passRate: null,
      assessedCount: 0,
      passCount: 0,
    });
  });

  const enrolment = (over: Partial<Enrolment>): Enrolment =>
    ({
      id: 'e1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: null,
      completedAt: null,
      cancelledAt: null,
      agreedPrice: null,
      ...over,
    }) as Enrolment;

  it('splits activity into the two 12-month windows', async () => {
    const result = await service.compare(
      'org-1',
      [
        enrolment({ id: 'a', activatedAt: new Date('2026-01-10T00:00:00Z') }),
        enrolment({ id: 'b', activatedAt: new Date('2024-10-01T00:00:00Z') }),
        enrolment({
          id: 'c',
          completedAt: new Date('2026-02-01T00:00:00Z'),
          agreedPrice: '18000',
        }),
        enrolment({
          id: 'd',
          completedAt: new Date('2024-12-01T00:00:00Z'),
          agreedPrice: '20000',
        }),
      ],
      NOW,
    );

    expect(result.currentPeriod.starts).toBe(1);
    expect(result.currentPeriod.completions).toBe(1);
    expect(result.currentPeriod.averageCostPerCompletion).toBe(18000);
    expect(result.priorPeriod?.starts).toBe(1);
    expect(result.priorPeriod?.completions).toBe(1);
    expect(result.priorPeriod?.averageCostPerCompletion).toBe(20000);
    expect(result.hasPriorPeriodData).toBe(true);
  });

  /**
   * The heart of "where historical data exists". An organisation live for
   * under two years has no baseline, and a board report showing "0% change"
   * against an absent one invites a decision founded on a number that
   * actually means "we don't know".
   */
  it('reports no prior period rather than a zeroed one', async () => {
    const result = await service.compare(
      'org-1',
      [enrolment({ activatedAt: new Date('2026-01-10T00:00:00Z') })],
      NOW,
    );

    expect(result.hasPriorPeriodData).toBe(false);
    expect(result.priorPeriod).toBeNull();
    expect(result.startsChangePercent).toBeNull();
    expect(result.completionsChangePercent).toBeNull();
    expect(result.levySpendChangePercent).toBeNull();
    expect(result.epaPassRatePointChange).toBeNull();
  });

  it('computes percentage change when a baseline exists', async () => {
    const result = await service.compare(
      'org-1',
      [
        enrolment({ id: 'a', activatedAt: new Date('2026-01-10T00:00:00Z') }),
        enrolment({ id: 'b', activatedAt: new Date('2026-02-10T00:00:00Z') }),
        enrolment({ id: 'c', activatedAt: new Date('2026-03-10T00:00:00Z') }),
        enrolment({ id: 'd', activatedAt: new Date('2024-10-01T00:00:00Z') }),
        enrolment({ id: 'e', activatedAt: new Date('2024-11-01T00:00:00Z') }),
      ],
      NOW,
    );

    // 3 vs 2 = +50%
    expect(result.startsChangePercent).toBe(50);
  });

  /**
   * Growth from nothing is not a percentage. "+100%" would read as a real
   * trend rather than a first year of activity.
   */
  it('returns null rather than a percentage when the baseline is zero', async () => {
    const result = await service.compare(
      'org-1',
      [
        enrolment({ id: 'a', activatedAt: new Date('2026-01-10T00:00:00Z') }),
        // Gives the prior period *some* data, but no starts.
        enrolment({ id: 'b', completedAt: new Date('2024-12-01T00:00:00Z') }),
      ],
      NOW,
    );

    expect(result.hasPriorPeriodData).toBe(true);
    expect(result.priorPeriod?.starts).toBe(0);
    expect(result.startsChangePercent).toBeNull();
  });

  it('buckets levy spend into the window its month falls in', async () => {
    monthlyService.listRecentMonths.mockResolvedValue([
      { month: '2026-01-01', spend: '5000', contributions: '6000' },
      { month: '2025-09-01', spend: '3000', contributions: '4000' },
      // Prior window.
      { month: '2024-09-01', spend: '2000', contributions: '2500' },
    ]);

    const result = await service.compare('org-1', [], NOW);

    expect(result.currentPeriod.levySpend).toBe(8000);
    expect(result.priorPeriod?.levySpend).toBe(2000);
    // 8000 vs 2000 = +300%
    expect(result.levySpendChangePercent).toBe(300);
  });

  /** Rates move in percentage points, which is how a board reads them. */
  it('reports EPA movement in percentage points, not percent', async () => {
    epaMetrics.passRateForEnrolments
      .mockResolvedValueOnce({ passRate: 75, assessedCount: 4, passCount: 3 })
      .mockResolvedValueOnce({ passRate: 50, assessedCount: 2, passCount: 1 });

    const result = await service.compare('org-1', [], NOW);

    expect(result.currentPeriod.epaPassRate).toBe(75);
    expect(result.priorPeriod?.epaPassRate).toBe(50);
    expect(result.epaPassRatePointChange).toBe(25);
  });

  it('counts a withdrawal only when the enrolment is actually cancelled', async () => {
    const result = await service.compare(
      'org-1',
      [
        enrolment({
          id: 'a',
          status: EnrolmentStatus.CANCELLED,
          cancelledAt: new Date('2026-02-01T00:00:00Z'),
        }),
        // A cancelledAt timestamp left behind on a reinstated enrolment must
        // not be counted.
        enrolment({
          id: 'b',
          status: EnrolmentStatus.ACTIVE,
          cancelledAt: new Date('2026-03-01T00:00:00Z'),
        }),
      ],
      NOW,
    );

    expect(result.currentPeriod.withdrawals).toBe(1);
  });

  it('asks for 24 months of levy history, not 12', async () => {
    await service.compare('org-1', [], NOW);

    expect(monthlyService.listRecentMonths).toHaveBeenCalledWith('org-1', 24);
  });
});
