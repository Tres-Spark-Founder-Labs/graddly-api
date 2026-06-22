import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { InterventionActionType } from '../enums/intervention-action-type.enum.js';
import {
  InterventionFlagReason,
  LearnerStatusBadge,
} from '../utils/learner-status-badge.util.js';

export class InterventionQueueEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ example: 'Jane Smith' })
  learnerName!: string;

  @ApiProperty({
    type: [String],
    enum: InterventionFlagReason,
    description: 'Reasons the learner appears in the queue',
  })
  flagReasons!: InterventionFlagReason[];

  @ApiProperty({
    description: 'Severity score (higher = more urgent)',
    example: 85,
  })
  severityScore!: number;

  @ApiProperty({
    description: 'Days since last OTJ log, review, or message activity',
    example: 12,
  })
  daysSinceLastActivity!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  tutorUserId!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Alex Tutor' })
  tutorName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Acme Ltd' })
  employerName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'John Manager' })
  employerContactName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'john@acme.example.com' })
  employerContactEmail!: string | null;
}

export class InterventionQueueResponseDto {
  @ApiProperty({ type: [InterventionQueueEntryResponseDto] })
  items!: InterventionQueueEntryResponseDto[];

  @ApiProperty({
    description: 'Count of at-risk learners for sidebar badge',
    example: 3,
  })
  atRiskCount!: number;
}

export class InterventionActionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ enum: InterventionActionType })
  actionType!: InterventionActionType;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'uuid' })
  createdByUserId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class LearnerCohortEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ example: 'Jane Smith' })
  learnerName!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Acme Ltd' })
  employerName!: string | null;

  @ApiProperty({ example: 'Software Developer Level 4' })
  standardTitle!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  startDate!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 42.5 })
  otjPercent!: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  nextReviewDate!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  epaDate!: string | null;

  @ApiProperty({ enum: LearnerStatusBadge })
  statusBadge!: LearnerStatusBadge;

  @ApiPropertyOptional({ nullable: true, example: 'Alex Tutor' })
  tutorName!: string | null;
}
