import {
  daysUntil,
  filterRoster,
  matchesAdvancedFilters,
  matchesRosterFilter,
  matchesRosterSearch,
  monthKey,
  monthLabel,
  normalisePaceStatus,
  rosterStatusLabel,
  sortRoster,
  type IApprenticeRosterRow,
} from './apprentice-roster.rules.js';
import { ApprenticeRosterFilter } from './dto/export-apprentice-roster.dto.js';

/**
 * F1.2.1 AC6 — the roster PDF applies the screen's rules.
 *
 * These are the employer portal's own cases
 * (`apps/employer/features/apprentices/utils/roster-export.test.js`), run
 * against the server-side port. The two implementations are held to one
 * set of expectations so the PDF cannot quietly contain rows the person
 * could not see, or in an order they did not choose.
 */
const apprentice = (
  overrides: Partial<IApprenticeRosterRow> = {},
): IApprenticeRosterRow => ({
  id: 'a-1',
  name: 'Priya Sharma',
  employeeId: 'EMP-04821',
  standard: 'Software Developer (L4)',
  provider: 'Midlands Technical College',
  status: 'on_track',
  epaDateIso: '2026-10-12',
  startDateIso: '2025-09-01',
  epaDaysLeft: 200,
  otjActual: 62,
  attendance: null,
  lastActivity: null,
  ...overrides,
});

describe('matchesRosterFilter — F1.2.1 AC4 (status pills)', () => {
  it("passes everything when no filter or 'all'", () => {
    expect(matchesRosterFilter(apprentice(), ApprenticeRosterFilter.ALL)).toBe(
      true,
    );
    expect(matchesRosterFilter(apprentice(), undefined)).toBe(true);
  });

  it('matches on status', () => {
    expect(
      matchesRosterFilter(
        apprentice({ status: 'at_risk' }),
        ApprenticeRosterFilter.AT_RISK,
      ),
    ).toBe(true);
    expect(
      matchesRosterFilter(
        apprentice({ status: 'on_track' }),
        ApprenticeRosterFilter.AT_RISK,
      ),
    ).toBe(false);
    expect(
      matchesRosterFilter(
        apprentice({ status: 'critically_behind' }),
        ApprenticeRosterFilter.CRITICALLY_BEHIND,
      ),
    ).toBe(true);
  });

  it('treats epa_imminent as a derived view, not a stored status', () => {
    expect(
      matchesRosterFilter(
        apprentice({ epaDaysLeft: 40 }),
        ApprenticeRosterFilter.EPA_IMMINENT,
      ),
    ).toBe(true);
    expect(
      matchesRosterFilter(
        apprentice({ epaDaysLeft: 200 }),
        ApprenticeRosterFilter.EPA_IMMINENT,
      ),
    ).toBe(false);
  });

  it('excludes rows with an unknown EPA date from epa_imminent', () => {
    expect(
      matchesRosterFilter(
        apprentice({ epaDaysLeft: null }),
        ApprenticeRosterFilter.EPA_IMMINENT,
      ),
    ).toBe(false);
  });
});

describe('matchesRosterSearch — F1.2.1 AC5', () => {
  it('matches on name', () => {
    expect(matchesRosterSearch(apprentice(), 'priya')).toBe(true);
  });

  it('matches on employee ID', () => {
    expect(matchesRosterSearch(apprentice(), 'emp-048')).toBe(true);
  });

  it('matches standard and provider', () => {
    expect(matchesRosterSearch(apprentice(), 'midlands')).toBe(true);
    expect(matchesRosterSearch(apprentice(), 'software')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesRosterSearch(apprentice(), '  PRIYA  ')).toBe(true);
  });

  it('passes everything on an empty query', () => {
    expect(matchesRosterSearch(apprentice(), '')).toBe(true);
    expect(matchesRosterSearch(apprentice(), undefined)).toBe(true);
  });

  it('does not throw when a field is missing', () => {
    expect(
      matchesRosterSearch(apprentice({ employeeId: null, name: '' }), 'x'),
    ).toBe(false);
  });
});

describe('filterRoster — status and search combined', () => {
  it('applies both', () => {
    const roster = [
      apprentice({ id: '1', name: 'Priya', status: 'at_risk' }),
      apprentice({ id: '2', name: 'Priya', status: 'on_track' }),
      apprentice({ id: '3', name: 'Tom', status: 'at_risk' }),
    ];
    const result = filterRoster(roster, {
      filter: ApprenticeRosterFilter.AT_RISK,
      search: 'priya',
    });
    expect(result.map((r) => r.id)).toEqual(['1']);
  });
});

describe('matchesAdvancedFilters — F1.2.1 AC4', () => {
  const a = apprentice();

  it('passes when no advanced filter is set', () => {
    expect(matchesAdvancedFilters(a, {})).toBe(true);
  });

  it('filters by provider and standard', () => {
    expect(
      matchesAdvancedFilters(a, { provider: 'Midlands Technical College' }),
    ).toBe(true);
    expect(matchesAdvancedFilters(a, { provider: 'Someone Else' })).toBe(false);
    expect(
      matchesAdvancedFilters(a, { standard: 'Software Developer (L4)' }),
    ).toBe(true);
  });

  it('filters by EPA month and cohort month', () => {
    expect(matchesAdvancedFilters(a, { epaMonth: '2026-10' })).toBe(true);
    expect(matchesAdvancedFilters(a, { epaMonth: '2026-11' })).toBe(false);
    expect(matchesAdvancedFilters(a, { cohort: '2025-09' })).toBe(true);
  });

  it('combines filters as AND', () => {
    expect(
      matchesAdvancedFilters(a, {
        provider: 'Midlands Technical College',
        epaMonth: '2026-11',
      }),
    ).toBe(false);
  });

  it('excludes rows with no date when a date filter is active', () => {
    const undated = apprentice({ epaDateIso: null });
    expect(matchesAdvancedFilters(undated, { epaMonth: '2026-10' })).toBe(
      false,
    );
  });
});

describe('monthKey / monthLabel', () => {
  it('returns a sortable YYYY-MM key', () => {
    expect(monthKey('2026-10-12')).toBe('2026-10');
  });

  it('returns null for missing or unparseable dates', () => {
    expect(monthKey(null)).toBeNull();
    expect(monthKey('not a date')).toBeNull();
  });

  it('labels a month as the screen does', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
});

describe('sortRoster — F1.2.1 AC1 (sortable table)', () => {
  const roster = [
    apprentice({
      id: 'b',
      name: 'Bella',
      otjActual: 40,
      epaDateIso: '2026-12-01',
    }),
    apprentice({
      id: 'a',
      name: 'Aaron',
      otjActual: 90,
      epaDateIso: '2026-01-15',
    }),
    apprentice({
      id: 'c',
      name: 'Chris',
      otjActual: 65,
      epaDateIso: '2026-06-30',
    }),
  ];

  it('sorts text ascending and descending', () => {
    expect(sortRoster(roster, { sortBy: 'name' }).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      sortRoster(roster, { sortBy: 'name', sortOrder: 'desc' }).map(
        (r) => r.id,
      ),
    ).toEqual(['c', 'b', 'a']);
  });

  it('sorts numbers numerically, not as strings', () => {
    const nums = [
      apprentice({ id: 'x', otjActual: 100 }),
      apprentice({ id: 'y', otjActual: 40 }),
    ];
    expect(sortRoster(nums, { sortBy: 'otjActual' }).map((r) => r.id)).toEqual([
      'y',
      'x',
    ]);
  });

  it('sorts dates chronologically using the raw ISO value', () => {
    expect(sortRoster(roster, { sortBy: 'epaDate' }).map((r) => r.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('keeps blanks last in both directions', () => {
    const mixed = [
      apprentice({ id: 'empty', otjActual: null }),
      apprentice({ id: 'low', otjActual: 10 }),
      apprentice({ id: 'high', otjActual: 90 }),
    ];
    expect(sortRoster(mixed, { sortBy: 'otjActual' }).map((r) => r.id)).toEqual(
      ['low', 'high', 'empty'],
    );
    expect(
      sortRoster(mixed, { sortBy: 'otjActual', sortOrder: 'desc' }).map(
        (r) => r.id,
      ),
    ).toEqual(['high', 'low', 'empty']);
  });

  it('treats the em-dash placeholder as blank', () => {
    const mixed = [
      apprentice({ id: 'dash', provider: '—' }),
      apprentice({ id: 'real', provider: 'Alpha College' }),
    ];
    expect(sortRoster(mixed, { sortBy: 'provider' }).map((r) => r.id)).toEqual([
      'real',
      'dash',
    ]);
  });

  it('returns the list unchanged for an absent sort key', () => {
    expect(sortRoster(roster, {}).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('is stable: equal keys keep the roster order', () => {
    const ties = [
      apprentice({ id: 'first', status: 'on_track' }),
      apprentice({ id: 'second', status: 'on_track' }),
      apprentice({ id: 'third', status: 'at_risk' }),
    ];
    expect(sortRoster(ties, { sortBy: 'status' }).map((r) => r.id)).toEqual([
      'third',
      'first',
      'second',
    ]);
  });

  it('does not mutate the input array', () => {
    const original = [...roster];
    sortRoster(roster, { sortBy: 'name' });
    expect(roster).toEqual(original);
  });
});

describe('the pace vocabulary — F1.2.4 AC5 as the portal translates it', () => {
  it('maps the stored level to the screen status, a missing one to unknown — never on track', () => {
    expect(normalisePaceStatus('off_track')).toBe('critically_behind');
    expect(normalisePaceStatus('at_risk')).toBe('at_risk');
    expect(normalisePaceStatus('on_track')).toBe('on_track');
    expect(normalisePaceStatus(null)).toBe('unknown');
    expect(normalisePaceStatus(undefined)).toBe('unknown');
    expect(normalisePaceStatus('something_new')).toBe('unknown');
  });

  it('labels statuses as the badges do', () => {
    expect(rosterStatusLabel('critically_behind')).toBe('Critically behind');
    expect(rosterStatusLabel('at_risk')).toBe('At risk');
    expect(rosterStatusLabel('on_track')).toBe('On track');
    expect(rosterStatusLabel('unknown')).toBe('Pace unknown');
  });

  it('counts days to EPA rounded up, and null for no date', () => {
    const now = Date.UTC(2026, 8, 21);
    expect(daysUntil('2026-10-12', now)).toBe(21);
    expect(daysUntil(null, now)).toBeNull();
  });
});
