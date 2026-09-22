import {
  ApprenticeRosterFilter,
  type ApprenticeRosterSortColumn,
  type ApprenticeRosterSortOrder,
  type ExportApprenticeRosterDto,
} from './dto/export-apprentice-roster.dto.js';

// Twin: gradlly-frontend apps/employer/features/apprentices/utils/roster-export.js applies these rules to the table on screen — change one, change the other.
/**
 * F1.2.1 AC6 — the roster's filter, search and sort rules, server-side.
 *
 * ── THIS IS A PORT, AND MUST STAY ONE ───────────────────────────────────────
 *
 * The employer portal filters and sorts the roster in the browser
 * (`apps/employer/features/apprentices/utils/roster-export.js`), and the CSV
 * export writes the rows that produced. The PDF is rendered here, from the
 * same request parameters, so these functions are that file's rules written
 * again in TypeScript: the same predicate per pill, the same four search
 * fields, the same month key, the same blanks-last sort. A change to one
 * side without the other puts rows in the PDF the person cannot see on
 * screen, which is the defect the CSV export was built to avoid.
 *
 * The spec beside this file carries the portal's test cases for that reason.
 */

/** The roster's pace vocabulary — the portal's, not the stored one. */
export type ApprenticeRosterStatus =
  | 'on_track'
  | 'at_risk'
  | 'critically_behind';

/** The badge text the screen shows (`statusMeta` in the portal). */
export function rosterStatusLabel(status: ApprenticeRosterStatus): string {
  switch (status) {
    case 'at_risk':
      return 'At risk';
    case 'critically_behind':
      return 'Critically behind';
    default:
      return 'On track';
  }
}

/** One row as the screen composes it: an apprentice plus their best enrolment. */
export interface IApprenticeRosterRow {
  id: string;
  name: string;
  employeeId: string | null;
  /** Display name, or '—' when there is no enrolment: as the screen holds it. */
  standard: string;
  provider: string;
  status: ApprenticeRosterStatus;
  epaDateIso: string | null;
  startDateIso: string | null;
  epaDaysLeft: number | null;
  /** Unpopulated for employers today; kept so the sort keys exist. */
  otjActual: number | null;
  attendance: number | null;
  lastActivity: string | null;
}

/**
 * The stored pace level, as the portal translates it. Null (no planned
 * duration or end date) reads as on track for the reason `risk-status.js`
 * gives: a red flag for missing programme dates would be a false alarm about
 * the apprentice rather than a true one about the data.
 */
export function normalisePaceStatus(
  level: string | null | undefined,
): ApprenticeRosterStatus {
  switch (level) {
    case 'at_risk':
      return 'at_risk';
    case 'off_track':
      return 'critically_behind';
    default:
      return 'on_track';
  }
}

/** Whole days until the date, rounded up — the screen's `daysUntil`. */
export function daysUntil(
  iso: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - now) / 86_400_000);
}

/** Status filter pills. `epa_imminent` is a derived view, not a stored status. */
export function matchesRosterFilter(
  row: IApprenticeRosterRow,
  filter: ApprenticeRosterFilter | undefined,
): boolean {
  if (!filter || filter === ApprenticeRosterFilter.ALL) return true;
  if (filter === ApprenticeRosterFilter.EPA_IMMINENT) {
    const days = row.epaDaysLeft;
    return typeof days === 'number' && days < 90;
  }
  // The remaining pills name a status in the roster's own vocabulary.
  return row.status === (filter as string);
}

/** F1.2.1 AC5 — name or employee ID (plus standard/provider, which are free). */
export function matchesRosterSearch(
  row: IApprenticeRosterRow,
  query: string | undefined,
): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') return true;
  return [row.name, row.standard, row.provider, row.employeeId].some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(q),
  );
}

/**
 * "2026-10" from an ISO date, or null. The portal reads the browser's local
 * year and month; a date-only value is UTC midnight, so UTC is the month the
 * date names, and what a UK browser sees too.
 */
export function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "Oct 2026" for the filter summary. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function matchesAdvancedFilters(
  row: IApprenticeRosterRow,
  advanced: Pick<
    ExportApprenticeRosterDto,
    'provider' | 'standard' | 'epaMonth' | 'cohort'
  >,
): boolean {
  const { provider, standard, epaMonth, cohort } = advanced;
  if (provider && row.provider !== provider) return false;
  if (standard && row.standard !== standard) return false;
  if (epaMonth && monthKey(row.epaDateIso) !== epaMonth) return false;
  if (cohort && monthKey(row.startDateIso) !== cohort) return false;
  return true;
}

export function filterRoster(
  rows: IApprenticeRosterRow[],
  query: ExportApprenticeRosterDto,
): IApprenticeRosterRow[] {
  return rows.filter(
    (row) =>
      matchesRosterFilter(row, query.filter) &&
      matchesRosterSearch(row, query.search) &&
      matchesAdvancedFilters(row, query),
  );
}

// ─── Sorting (F1.2.1 AC1) ───────────────────────────────────────────────────

type SortValue = string | number | null | undefined;

/**
 * Sort keys map to the visible columns. Dates read the raw ISO value, not the
 * formatted string — sorting "12 Oct 2026" as text puts April before January.
 */
const SORT_ACCESSORS: Readonly<
  Record<ApprenticeRosterSortColumn, (row: IApprenticeRosterRow) => SortValue>
> = Object.freeze({
  name: (row) => row.name,
  standard: (row) => row.standard,
  provider: (row) => row.provider,
  otjActual: (row) => row.otjActual,
  epaDate: (row) => row.epaDateIso,
  attendance: (row) => row.attendance,
  lastActivity: (row) => row.lastActivity,
  status: (row) => row.status,
});

const isEmpty = (value: SortValue): boolean =>
  value === null || value === undefined || value === '' || value === '—';

/**
 * Stable sort with blanks always last.
 *
 * Blanks sink regardless of direction rather than flipping to the top on
 * ascending: three columns are unpopulated for employers today, and a naive
 * sort would fill the first page with empty rows.
 */
export function sortRoster(
  rows: IApprenticeRosterRow[],
  sort: {
    sortBy?: ApprenticeRosterSortColumn;
    sortOrder?: ApprenticeRosterSortOrder;
  },
): IApprenticeRosterRow[] {
  const list = [...rows];
  const read = sort.sortBy ? SORT_ACCESSORS[sort.sortBy] : undefined;
  if (!read) return list;

  const direction = sort.sortOrder === 'desc' ? -1 : 1;

  return list.sort((a, b) => {
    const left = read(a);
    const right = read(b);

    const leftEmpty = isEmpty(left);
    const rightEmpty = isEmpty(right);
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });
}

/** The column labels the screen shows, for the sort line on the document. */
export const APPRENTICE_ROSTER_COLUMN_LABELS: Readonly<
  Record<ApprenticeRosterSortColumn, string>
> = Object.freeze({
  name: 'Apprentice',
  standard: 'Standard',
  provider: 'Provider',
  otjActual: 'OTJ progress',
  epaDate: 'EPA date',
  attendance: 'Attendance',
  lastActivity: 'Last activity',
  status: 'Status',
});
