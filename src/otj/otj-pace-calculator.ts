import { OTJ_HOURS_PER_PLANNED_MONTH } from '../reporting/otj-progress-metrics.service.js';

import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';

export type OtjPaceSnapshot = {
  totalTargetMinutes: number;
  expectedMinutesByToday: number;
  approvedMinutes: number;
  behindPercent: number | null;
  alertLevel: OtjPaceAlertLevel | null;
  requiredWeeklyHours: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function resolveAlertLevel(
  behindPercent: number | null,
): OtjPaceAlertLevel | null {
  if (behindPercent === null) {
    return null;
  }
  if (behindPercent > 30) {
    return OtjPaceAlertLevel.OFF_TRACK;
  }
  if (behindPercent > 15) {
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
