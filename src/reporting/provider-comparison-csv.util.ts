import { escapeCsvField } from '../audit/audit-csv.util.js';

import type { LevyRoiBreakdownEntryResponseDto } from './dto/levy-roi-report-response.dto.js';

/**
 * F1.4.2 AC3 — "comparison is exportable as CSV".
 *
 * Column order follows the acceptance criterion so the file reads the way the
 * requirement is written, with the identifying columns first.
 */
const HEADERS = [
  'provider',
  'activeLearnerCount',
  'completions',
  'averageOtjPercent',
  'reviewComplianceRate',
  'epaPassRate',
  'epaAssessedCount',
  'withdrawalRate',
  'averageCostPerCompletion',
] as const;

/**
 * Empty rather than zero for an unmeasurable metric.
 *
 * A blank CSV cell is unambiguous once it reaches a spreadsheet: it is not
 * averaged, not charted, and not mistaken for a real score. Writing `0` for
 * "no reviews were due yet" or "nobody has sat EPA" would put a provider at
 * the bottom of a sort for having no history — the same failure the OTJ
 * scoping bug produced on screen.
 */
function cell(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function providerComparisonToCsv(
  rows: LevyRoiBreakdownEntryResponseDto[],
): string {
  const lines = [HEADERS.join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.label,
        String(row.activeApprenticeCount),
        String(row.completionCount),
        cell(row.averageOtjPercent),
        cell(row.reviewComplianceRate),
        cell(row.epaPassRate),
        String(row.epaAssessedCount ?? 0),
        cell(row.withdrawalRate),
        cell(row.averageCostPerCompletion),
      ]
        .map((value) => escapeCsvField(value))
        .join(','),
    );
  }

  return lines.join('\n');
}
