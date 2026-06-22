import type { IDasUtilisationSegments } from './types/das-utilisation-segments.types.js';

export interface IParsedLevyMonthlyEntry {
  month: string;
  contributions: number;
  spend: number;
}

const MONTH_KEY = /^\d{4}-\d{2}$/;

export function parseLevyMonthlyEntries(
  raw: Record<string, unknown>,
): IParsedLevyMonthlyEntry[] {
  const byMonth = new Map<string, IParsedLevyMonthlyEntry>();

  const contributionSources = [
    raw.monthlyContributions,
    raw.contributions,
    raw.levyContributions,
  ];
  for (const source of contributionSources) {
    ingestMonthlyArray(source, byMonth, 'contributions');
  }

  const spendSources = [
    raw.monthlySpend,
    raw.spend,
    raw.transactions,
    raw.transactionHistory,
  ];
  for (const source of spendSources) {
    ingestMonthlyArray(source, byMonth, 'spend');
  }

  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function parseUtilisationSegments(
  raw: Record<string, unknown>,
  balance: string | null,
  currency = 'GBP',
): IDasUtilisationSegments {
  const directUsed = pickNumber(raw, ['used', 'usedAmount', 'levyUsed']);
  const directExpiring = pickNumber(raw, [
    'expiringWithin90Days',
    'expiringAmount',
    'expiring',
  ]);
  const directAvailable = pickNumber(raw, [
    'available',
    'availableAmount',
    'levyAvailable',
  ]);

  if (
    directUsed !== null ||
    directExpiring !== null ||
    directAvailable !== null
  ) {
    return {
      used: directUsed ?? 0,
      expiringWithin90Days: directExpiring ?? 0,
      available: directAvailable ?? (balance !== null ? Number(balance) : 0),
      currency,
    };
  }

  const tranches = [
    ...toUnknownArray(raw.tranches),
    ...toUnknownArray(raw.expiryTranches),
    ...toUnknownArray(raw.levyTranches),
  ];

  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  let expiringWithin90Days = 0;
  let used = 0;

  for (const item of tranches) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const amount = pickNumber(row, [
      'amount',
      'balance',
      'levyAmount',
      'value',
    ]);
    if (amount === null) {
      continue;
    }
    const expiresOn = pickDateString(row, [
      'expiresOn',
      'expiryDate',
      'expiresAt',
    ]);
    if (!expiresOn) {
      used += amount;
      continue;
    }
    const expiresMs = Date.parse(expiresOn);
    if (Number.isNaN(expiresMs)) {
      used += amount;
      continue;
    }
    if (expiresMs <= now) {
      used += amount;
    } else if (expiresMs - now <= ninetyDaysMs) {
      expiringWithin90Days += amount;
    }
  }

  const available = balance !== null ? Number(balance) : 0;

  return {
    used: roundMoney(used),
    expiringWithin90Days: roundMoney(expiringWithin90Days),
    available: roundMoney(available),
    currency,
  };
}

function ingestMonthlyArray(
  source: unknown,
  byMonth: Map<string, IParsedLevyMonthlyEntry>,
  field: 'contributions' | 'spend',
): void {
  if (!Array.isArray(source)) {
    return;
  }

  for (const item of source) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const month = normalizeMonth(
      pickString(row, ['month', 'period', 'yearMonth', 'date']),
    );
    if (!month) {
      continue;
    }
    const amount = pickNumber(row, [
      'amount',
      'value',
      'contributions',
      'contribution',
      'spend',
      'spent',
    ]);
    if (amount === null) {
      continue;
    }

    const existing = byMonth.get(month) ?? {
      month,
      contributions: 0,
      spend: 0,
    };
    existing[field] = roundMoney(existing[field] + amount);
    byMonth.set(month, existing);
  }
}

function normalizeMonth(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (MONTH_KEY.test(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const date = new Date(parsed);
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return MONTH_KEY.test(month) ? month : null;
}

function pickString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickDateString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 10);
    }
  }
  return null;
}

function pickNumber(
  raw: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
