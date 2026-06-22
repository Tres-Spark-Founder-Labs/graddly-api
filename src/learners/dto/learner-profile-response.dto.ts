import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OtjLogStatus } from '../../otj/enums/otj-log-status.enum.js';
import { ReviewStatus } from '../../reviews/enums/review-status.enum.js';

import { LearnerDocumentItemDto } from './learner-document-item.dto.js';
import { InterventionActionResponseDto } from './learner-provider-response.dto.js';

export class LearnerProfilePersonalDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;
}

export class LearnerProfileEmployerDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  organisationId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organisationName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  managerName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  managerEmail!: string | null;
}

export class LearnerProfileProgrammeDto {
  @ApiProperty()
  standardTitle!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  plannedStartDate!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  plannedEndDate!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  epaDate!: string | null;
}

export class LearnerProfileTutorDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;
}

export class LearnerProfileReviewItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ReviewStatus })
  status!: ReviewStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: string;

  @ApiProperty()
  isOverdue!: boolean;

  @ApiProperty()
  tutorSigned!: boolean;

  @ApiProperty()
  apprenticeSigned!: boolean;
}

export class LearnerProfileOtjEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date' })
  loggedDate!: string;

  @ApiProperty()
  minutes!: number;

  @ApiProperty({ enum: OtjLogStatus })
  status!: OtjLogStatus;
}

export class LearnerProfileOtjDto {
  @ApiPropertyOptional({ nullable: true })
  otjPercent!: number | null;

  @ApiProperty({ type: [LearnerProfileOtjEntryDto] })
  recentEntries!: LearnerProfileOtjEntryDto[];
}

export class LearnerProfileBreakInLearningDto {
  @ApiProperty()
  active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  expectedReturnDate!: string | null;

  @ApiProperty({ type: [InterventionActionResponseDto] })
  recentInterventions!: InterventionActionResponseDto[];
}

export class LearnerProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ type: LearnerProfilePersonalDto })
  personal!: LearnerProfilePersonalDto;

  @ApiProperty({ type: LearnerProfileEmployerDto })
  employer!: LearnerProfileEmployerDto;

  @ApiProperty({ type: LearnerProfileProgrammeDto })
  programme!: LearnerProfileProgrammeDto;

  @ApiProperty({ type: LearnerProfileTutorDto })
  tutor!: LearnerProfileTutorDto;

  @ApiProperty({ type: [LearnerProfileReviewItemDto] })
  reviews!: LearnerProfileReviewItemDto[];

  @ApiProperty({ type: LearnerProfileOtjDto })
  otj!: LearnerProfileOtjDto;

  @ApiProperty({ type: [LearnerDocumentItemDto] })
  documents!: LearnerDocumentItemDto[];

  @ApiProperty({
    type: [String],
    description: 'Message thread UUIDs for this enrolment',
  })
  messageThreadIds!: string[];

  @ApiProperty({ type: LearnerProfileBreakInLearningDto })
  breakInLearning!: LearnerProfileBreakInLearningDto;
}
