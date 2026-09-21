import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * F1.2.1 AC6 — the state of the employer's roster screen, so the PDF is the
 * table the person is looking at.
 *
 * ── THE VOCABULARY IS THE SCREEN'S ──────────────────────────────────────────
 *
 * These are the values the employer portal holds in `ApprenticesDashboard`
 * and applies through `features/apprentices/utils/roster-export.js`. The
 * status pill uses the portal's pace vocabulary (`critically_behind`, not the
 * stored `off_track`), the provider and standard filters carry the display
 * names the dropdowns were built from, and the months are `YYYY-MM` exactly
 * as `monthKey` produces them. ApprenticeRosterService applies the same rules
 * server-side; the two are held to one set of expectations by their specs.
 */

export enum ApprenticeRosterFilter {
  ALL = 'all',
  ON_TRACK = 'on_track',
  AT_RISK = 'at_risk',
  CRITICALLY_BEHIND = 'critically_behind',
  /** Derived: an EPA date under 90 days away. Not a stored status. */
  EPA_IMMINENT = 'epa_imminent',
}

/** The sortable columns, named as the screen names them. */
export const APPRENTICE_ROSTER_SORT_COLUMNS = [
  'name',
  'standard',
  'provider',
  'otjActual',
  'epaDate',
  'attendance',
  'lastActivity',
  'status',
] as const;
export type ApprenticeRosterSortColumn =
  (typeof APPRENTICE_ROSTER_SORT_COLUMNS)[number];

export const APPRENTICE_ROSTER_SORT_ORDERS = ['asc', 'desc'] as const;
export type ApprenticeRosterSortOrder =
  (typeof APPRENTICE_ROSTER_SORT_ORDERS)[number];

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/u;

export class ExportApprenticeRosterDto {
  @ApiPropertyOptional({
    enum: ApprenticeRosterFilter,
    default: ApprenticeRosterFilter.ALL,
    description: 'The status pill. `epa_imminent` is EPA under 90 days away.',
  })
  @IsOptional()
  @IsEnum(ApprenticeRosterFilter)
  filter?: ApprenticeRosterFilter;

  @ApiPropertyOptional({
    description:
      'Search box: matched case-insensitively against name, standard, provider and employee ID.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'Provider filter, by display name (exact).',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  provider?: string;

  @ApiPropertyOptional({
    description: 'Standard filter, by display name (exact).',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  standard?: string;

  @ApiPropertyOptional({
    description: 'EPA month filter, `YYYY-MM`.',
    example: '2026-10',
  })
  @IsOptional()
  @Matches(MONTH_KEY, { message: 'epaMonth must be YYYY-MM' })
  epaMonth?: string;

  @ApiPropertyOptional({
    description: 'Cohort (planned start) month filter, `YYYY-MM`.',
    example: '2025-09',
  })
  @IsOptional()
  @Matches(MONTH_KEY, { message: 'cohort must be YYYY-MM' })
  cohort?: string;

  @ApiPropertyOptional({
    enum: APPRENTICE_ROSTER_SORT_COLUMNS,
    description: 'Sort column. Omitted means the roster order (newest first).',
  })
  @IsOptional()
  @IsIn(APPRENTICE_ROSTER_SORT_COLUMNS)
  sortBy?: ApprenticeRosterSortColumn;

  @ApiPropertyOptional({
    enum: APPRENTICE_ROSTER_SORT_ORDERS,
    default: 'asc',
  })
  @IsOptional()
  @IsIn(APPRENTICE_ROSTER_SORT_ORDERS)
  sortOrder?: ApprenticeRosterSortOrder;
}
