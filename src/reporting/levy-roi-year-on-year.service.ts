import { Injectable } from '@nestjs/common';

import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';

import type {
  LevyRoiPeriodDto,
  LevyRoiYearOnYearDto,
} from './dto/levy-roi-report-response.dto.js';
import type { Enrolment } from '../enrolments/entities/enrolment.entity.js';

/** A closed-open interval: `[start, end)`. */
interface IWindow {
  start: Date;
  end: Date;
}

function subtractMonths(from: Date, months: number): Date {
  const result = new Date(from);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function within(date: Date | null, window: IWindow): boolean {
  if (!date) return false;
  return date >= window.start && date < window.end;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function percentChange(current: number, prior: number): number | null {
  // Growth from nothing is not a percentage. Reporting "+100%" when the prior
  // year had no completions would read as a real trend rather than a first
  // year of activity.
  if (prior === 0) return null;
  return Number((((current - prior) / prior) * 100).toFixed(2));
}

function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number(
    (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2),
  );
}

/**
 * F1.4.1 AC3 — "year-on-year comparison available where historical data
 * exists".
 *
 * Compares the last 12 months against the 12 before them, on the metrics that
 * carry an event date and can therefore be honestly attributed to a period:
 * starts (`activatedAt`), completions (`completedAt`), withdrawals
 * (`cancelledAt`), levy spend (`das_levy_monthly`) and EPA pass rate
 * (`epa_outcomes.assessedOn`).
 *
 * **`totalLevySpendToDate` is deliberately not compared.** It is a running
 * proxy — latest DAS balance plus confirmed transfers — with no time
 * dimension at all. Differencing two snapshots of it would produce a number
 * that looks like a year's spend and is not.
 *
 * **"Where historical data exists" is the whole difficulty.** The prior window
 * is genuinely empty for any organisation less than two years live, and the
 * monthly levy table only accumulates as the platform runs. So the response
 * carries `hasPriorPeriodData`, and every delta is null rather than zero when
 * there is nothing to compare against. A board report showing "0% change"
 * against an absent baseline is worse than showing nothing: it invites a
 * decision founded on a number that means "we don't know".
 */
@Injectable()
export class LevyRoiYearOnYearService {
  constructor(
    private readonly monthlyService: DasLevyMonthlyService,
    private readonly epaMetrics: EpaOutcomeMetricsService,
  ) {}

  async compare(
    organisationId: string,
    enrolments: Enrolment[],
    now: Date = new Date(),
  ): Promise<LevyRoiYearOnYearDto> {
    const current: IWindow = { start: subtractMonths(now, 12), end: now };
    const prior: IWindow = {
      start: subtractMonths(now, 24),
      end: current.start,
    };

    const months = await this.monthlyService.listRecentMonths(
      organisationId,
      24,
    );
    const enrolmentIds = enrolments.map((e) => e.id);

    const [currentEpa, priorEpa] = await Promise.all([
      this.epaMetrics.passRateForEnrolments(enrolmentIds, {
        from: current.start,
        to: current.end,
      }),
      this.epaMetrics.passRateForEnrolments(enrolmentIds, {
        from: prior.start,
        to: prior.end,
      }),
    ]);

    const currentPeriod = this.buildPeriod(
      current,
      enrolments,
      months,
      currentEpa.passRate,
    );
    const priorPeriod = this.buildPeriod(
      prior,
      enrolments,
      months,
      priorEpa.passRate,
    );

    /**
     * "Historical data exists" means the prior window contains something, not
     * merely that the window can be computed — every window can. An
     * organisation with no activity and no levy record 13-24 months ago has
     * no baseline, whatever the calendar says.
     */
    const hasPriorPeriodData =
      priorPeriod.starts > 0 ||
      priorPeriod.completions > 0 ||
      priorPeriod.withdrawals > 0 ||
      priorPeriod.levySpend > 0 ||
      priorPeriod.epaPassRate !== null;

    return {
      currentPeriod,
      priorPeriod: hasPriorPeriodData ? priorPeriod : null,
      hasPriorPeriodData,
      startsChangePercent: hasPriorPeriodData
        ? percentChange(currentPeriod.starts, priorPeriod.starts)
        : null,
      completionsChangePercent: hasPriorPeriodData
        ? percentChange(currentPeriod.completions, priorPeriod.completions)
        : null,
      levySpendChangePercent: hasPriorPeriodData
        ? percentChange(currentPeriod.levySpend, priorPeriod.levySpend)
        : null,
      // Rates are compared in percentage *points*. A pass rate moving 50% →
      // 75% is +25 points, not +50%, and boards read the point difference.
      epaPassRatePointChange:
        hasPriorPeriodData &&
        currentPeriod.epaPassRate !== null &&
        priorPeriod.epaPassRate !== null
          ? Number(
              (currentPeriod.epaPassRate - priorPeriod.epaPassRate).toFixed(2),
            )
          : null,
    };
  }

  private buildPeriod(
    window: IWindow,
    enrolments: Enrolment[],
    months: Array<{ month: string; spend: string; contributions: string }>,
    epaPassRate: number | null,
  ): LevyRoiPeriodDto {
    const completedInWindow = enrolments.filter((e) =>
      within(e.completedAt, window),
    );

    const monthKeys = new Set(this.monthKeysIn(window));
    const spend = months
      .filter((m) => monthKeys.has(m.month.slice(0, 7)))
      .reduce((sum, m) => sum + Number(m.spend), 0);

    return {
      label: `${monthKey(window.start)} to ${monthKey(
        subtractMonths(window.end, 1),
      )}`,
      from: window.start.toISOString(),
      to: window.end.toISOString(),
      starts: enrolments.filter((e) => within(e.activatedAt, window)).length,
      completions: completedInWindow.length,
      withdrawals: enrolments.filter(
        (e) =>
          within(e.cancelledAt, window) &&
          e.status === EnrolmentStatus.CANCELLED,
      ).length,
      levySpend: Number(spend.toFixed(2)),
      averageCostPerCompletion: averageOf(
        completedInWindow
          .map((e) => (e.agreedPrice !== null ? Number(e.agreedPrice) : NaN))
          .filter((v) => !Number.isNaN(v)),
      ),
      epaPassRate,
    };
  }

  /** The `YYYY-MM` keys a window covers, so monthly rows can be bucketed. */
  private monthKeysIn(window: IWindow): string[] {
    const keys: string[] = [];
    const cursor = new Date(
      Date.UTC(
        window.start.getUTCFullYear(),
        window.start.getUTCMonth(),
        1,
        0,
        0,
        0,
      ),
    );
    while (cursor < window.end) {
      keys.push(monthKey(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return keys;
  }
}
