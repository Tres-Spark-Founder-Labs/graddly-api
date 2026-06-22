import { escapeCsvField } from '../audit/audit-csv.util.js';

import type { LearnerCohortEntryResponseDto } from './dto/learner-provider-response.dto.js';

const CSV_HEADERS = [
  'enrolmentId',
  'learnerName',
  'employerName',
  'standardTitle',
  'startDate',
  'otjPercent',
  'nextReviewDate',
  'epaDate',
  'statusBadge',
  'tutorName',
] as const;

export function cohortEntriesToCsv(
  rows: LearnerCohortEntryResponseDto[],
): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.enrolmentId,
        row.learnerName,
        row.employerName ?? '',
        row.standardTitle,
        row.startDate ?? '',
        row.otjPercent ?? '',
        row.nextReviewDate ?? '',
        row.epaDate ?? '',
        row.statusBadge,
        row.tutorName ?? '',
      ]
        .map((value) => escapeCsvField(String(value)))
        .join(','),
    );
  }
  return lines.join('\n');
}
