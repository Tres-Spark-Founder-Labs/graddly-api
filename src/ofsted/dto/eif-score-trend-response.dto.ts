import { ApiProperty } from '@nestjs/swagger';

import { EifRag } from '../enums/eif-rag.enum.js';

/** One criterion's score on one captured day. */
export class EifTrendPointDto {
  @ApiProperty({ example: '2026-07-14', format: 'date' })
  capturedOn!: string;

  @ApiProperty({ example: 78 })
  percent!: number;

  @ApiProperty({ enum: EifRag })
  rag!: EifRag;
}

export class EifCriterionTrendDto {
  @ApiProperty({ example: 'safeguarding' })
  slug!: string;

  @ApiProperty({ example: 'Safeguarding' })
  label!: string;

  @ApiProperty({
    type: [EifTrendPointDto],
    description: 'Oldest first, one point per captured day.',
  })
  points!: EifTrendPointDto[];
}

/**
 * F2.1.1 — "historical trend chart is available per criterion showing last 12
 * months of score movement".
 *
 * Deliberately reports how much history exists rather than leaving the client
 * to infer it from an array length. A provider onboarded last week has one
 * point, and a chart drawn through one point looks like a flat trend rather
 * than an absent one — the same distinction F1.4.1 AC3 had to make between
 * "no change" and "nothing to compare against".
 */
export class EifScoreTrendResponseDto {
  @ApiProperty({
    type: [EifCriterionTrendDto],
    description:
      'One series per EIF criterion, in the catalogue order used by the hub.',
  })
  criteria!: EifCriterionTrendDto[];

  @ApiProperty({
    type: [EifTrendPointDto],
    description: 'Overall readiness across the same days.',
  })
  overall!: EifTrendPointDto[];

  @ApiProperty({
    example: 34,
    description: 'How many days were captured in the window.',
  })
  pointCount!: number;

  @ApiProperty({
    example: false,
    description:
      'True once there is enough history to read as a trend rather than a ' +
      'handful of readings. Below this the client should say so rather than ' +
      'draw a line.',
  })
  hasTrendData!: boolean;

  @ApiProperty({
    nullable: true,
    example: '2026-06-28',
    format: 'date',
    description: 'Earliest captured day in the window; null when empty.',
  })
  earliestCapturedOn!: string | null;

  @ApiProperty({ example: 12 })
  windowMonths!: number;
}
