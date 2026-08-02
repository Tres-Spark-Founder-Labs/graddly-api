import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { SarReportStatus } from '../enums/sar-report-status.enum.js';
import { SarGrade } from '../sar-template.config.js';

import type { SarMetrics } from '../entities/sar-report.entity.js';

export class SarSectionResponseDto {
  @ApiProperty({ example: 'curriculum_intent' })
  key!: string;

  @ApiProperty({ example: 'Quality of education — intent' })
  heading!: string;

  @ApiProperty({ description: "The provider's narrative for this section." })
  narrative!: string;

  @ApiProperty({ enum: SarGrade, nullable: true })
  grade!: SarGrade | null;

  @ApiProperty({ description: 'Whether this section carries a grade.' })
  graded!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'EIF criterion whose live score seeds this section.',
  })
  eifCriterionSlug!: string | null;

  @ApiProperty({
    description: 'Explains to the writer what belongs in this section.',
  })
  guidance!: string;
}

export class SarReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ example: '2025-26' })
  academicYear!: string;

  @ApiProperty({ enum: SarReportStatus })
  status!: SarReportStatus;

  @ApiProperty({ type: [SarSectionResponseDto] })
  sections!: SarSectionResponseDto[];

  @ApiProperty({
    description:
      'The figures behind the report. Live while the SAR is a draft; frozen ' +
      'at the moment of locking, so a historical SAR keeps the numbers it ' +
      'was written against.',
  })
  metrics!: SarMetrics;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lockedAt!: string | null;

  @ApiProperty({
    description:
      'False once locked. AC4 — a locked SAR is a historical record and is ' +
      'immutable in the database, not only in the service.',
  })
  editable!: boolean;
}
