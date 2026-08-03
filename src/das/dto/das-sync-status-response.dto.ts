import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DasSyncHealth } from '../enums/das-sync-health.enum.js';

/**
 * F2.3.1 AC5 — "sync status indicator shows: last sync time, sync health
 * (green / amber / red), and error count".
 *
 * Every field is derived from `das_api_activity` rather than stored, so the
 * indicator cannot disagree with the log it summarises. A green light over a
 * page of failures is the specific failure mode this shape rules out.
 */
export class DasSyncStatusResponseDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a sync operation last succeeded. Null when none ever has — ' +
      'which is a different state from "the last one failed".',
  })
  lastSyncAt!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When a sync was last attempted, successful or not.',
  })
  lastAttemptAt!: string | null;

  @ApiProperty({
    enum: DasSyncHealth,
    description:
      'green: recent success, no recent failures. amber: succeeding but with ' +
      'failures in the window, or no sync in over a day. red: the most recent ' +
      'attempt failed, or nothing has ever succeeded.',
  })
  health!: DasSyncHealth;

  @ApiProperty({
    description: 'Failed DAS calls within the window (all operations).',
  })
  errorCount!: number;

  @ApiProperty({ description: 'Hours the error count is measured over.' })
  windowHours!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The most recent failure message, for the indicator tooltip.',
  })
  lastErrorMessage!: string | null;
}
