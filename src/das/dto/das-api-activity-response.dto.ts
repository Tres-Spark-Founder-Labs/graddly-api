import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DasApiOperation } from '../enums/das-api-operation.enum.js';

/**
 * F2.3.1 AC7 — one recorded call to the ESFA, as the portal shows it.
 *
 * `requestSummary` has already been scrubbed on write; nothing here has ever
 * held a bearer token. See `das-activity-scrub.util.ts`.
 */
export class DasApiActivityResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: DasApiOperation })
  operation!: DasApiOperation;

  @ApiProperty({ example: 'POST' })
  method!: string;

  @ApiProperty({ description: 'Credentials in the query string are redacted.' })
  url!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Null when no reply was received at all — a timeout or a DNS failure. ' +
      'Distinct from a 5xx, which means the ESFA answered and refused.',
  })
  responseStatus!: number | null;

  @ApiProperty()
  succeeded!: boolean;

  @ApiProperty()
  durationMs!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage!: string | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  requestSummary!: Record<string, unknown> | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  triggeredByUserId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
}
