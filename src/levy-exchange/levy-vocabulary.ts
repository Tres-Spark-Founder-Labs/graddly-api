/**
 * The Levy Exchange vocabulary — the one list of the values matching compares.
 *
 * ── WHY ONE LIST ────────────────────────────────────────────────────────────
 *
 * `LevyMatchingService` keeps a donor only if `preferredValues.includes(
 * actualValue)` on every field the donor filters, and `Array.includes` is
 * exact: case-, punctuation- and whitespace-sensitive. Three lists were in use
 * and none was authoritative — the eligibility checker's slugs (`north_west`,
 * `10_49`), this API's DTO examples, and the employer app's donor chips
 * ("North West", "10-49"), copied into the flow app because they were what
 * matching actually met. A near-miss fails quietly: it still matches donors
 * with open matching or no preference on the field, and fails only donors who
 * filter, so it never shows up as an obvious zero.
 *
 * Served by GET /levy-exchange/vocabulary; both portals read it and neither
 * keeps a copy. The values are the display strings stored on both sides, so
 * they are not slugs and are never lowercased.
 *
 * ── CLOSED AND OPEN ─────────────────────────────────────────────────────────
 *
 * A field is closed only where the real-world set is closed:
 *
 *   region             CLOSED  the twelve UK regions (ITL1: nine English
 *                              regions, Wales, Scotland, Northern Ireland)
 *   employeeCountBand  CLOSED  four bands that cover every size
 *   sector             OPEN    no list of UK SME sectors is complete
 *   programmeType      OPEN    there are several hundred apprenticeship
 *                              standards
 *
 * Closed values are validated on write, on both sides. Open values are not —
 * a list of suggestions is not a vocabulary, and closing a field on five
 * sectors would stop an SME in retail saying so — but they are normalised on
 * write, on both sides, so two parties typing the same words meet.
 */

export const LEVY_REGIONS = Object.freeze([
  'North East',
  'North West',
  'Yorkshire and the Humber',
  'East Midlands',
  'West Midlands',
  'East of England',
  'London',
  'South East',
  'South West',
  'Wales',
  'Scotland',
  'Northern Ireland',
] as const);

export const LEVY_EMPLOYEE_COUNT_BANDS = Object.freeze([
  '1-9',
  '10-49',
  '50-249',
  '250+',
] as const);

/** Suggestions only. "Digital & Technology" is also the eligibility checker's funding-band key. */
export const LEVY_SECTOR_SUGGESTIONS = Object.freeze([
  'Construction',
  'Digital & Technology',
  'Engineering & Manufacturing',
  'Financial Services',
  'Health & Social Care',
] as const);

/** Suggestions only. */
export const LEVY_PROGRAMME_TYPE_SUGGESTIONS = Object.freeze([
  'ST0145 Engineering Technician',
  'ST0415 Software Developer',
  'ST0215 Senior Healthcare Support Worker',
] as const);

/**
 * Normalisation for an open field: trim, and collapse internal runs of
 * whitespace to one space. Not lowercased — these are display strings on both
 * sides and matching is exact. Applied to both the recipient profile and the
 * donor's preferences, or it buys nothing.
 */
export function normaliseOpenVocabularyValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** The rejection message for a closed field: names the field and every permitted value. */
export function closedVocabularyMessage(
  field: string,
  permitted: readonly string[],
): string {
  return `${field} must be one of the permitted values: ${permitted.join(', ')}`;
}
