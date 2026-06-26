import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';

export class LearnerMeSummaryOtjPaceDto {
  @ApiPropertyOptional({ enum: OtjPaceAlertLevel, nullable: true })
  alertLevel!: OtjPaceAlertLevel | null;

  @ApiProperty({ example: 42.5 })
  otjPercent!: number | null;

  @ApiProperty({ example: 1200 })
  approvedMinutes!: number;
}

export class LearnerMeSummaryResponseDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  activeEnrolmentId!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Apprentice record id for the active enrolment',
  })
  activeApprenticeId!: string | null;

  @ApiPropertyOptional({
    example: 'Software Developer Standard',
    nullable: true,
  })
  programmeTitle!: string | null;

  @ApiPropertyOptional({ enum: EnrolmentStatus, nullable: true })
  enrolmentStatus!: EnrolmentStatus | null;

  @ApiProperty({ type: LearnerMeSummaryOtjPaceDto })
  otjPace!: LearnerMeSummaryOtjPaceDto;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  nextReviewDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Days until EPA; null when EPA date unset',
  })
  daysToEpa!: number | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  epaDate!: string | null;
}
