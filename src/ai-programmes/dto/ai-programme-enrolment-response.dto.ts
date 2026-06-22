import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import { AiProgrammeModuleProgressStatus } from '../enums/ai-programme-module-progress-status.enum.js';

export class AiProgrammeEnrolmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({ format: 'uuid' })
  programmeId!: string;

  @ApiProperty({ format: 'uuid' })
  standardId!: string;

  @ApiProperty({ format: 'uuid' })
  providerOrganisationId!: string;

  @ApiProperty({ enum: EnrolmentStatus })
  status!: EnrolmentStatus;

  @ApiProperty({
    description: 'Progress rows initialized for each catalogue module',
  })
  progressModuleCount!: number;
}

export class AiProgrammeProgressModuleDto {
  @ApiProperty({ example: 'foundations' })
  moduleSlug!: string;

  @ApiProperty({ example: 'AI Foundations' })
  title!: string;

  @ApiProperty({
    enum: ['not_started', 'in_progress', 'completed'],
    example: 'in_progress',
  })
  status!: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  completedAt!: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown> | null;
}

export class AiProgrammeProgressSummaryDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ enum: EnrolmentStatus })
  enrolmentStatus!: EnrolmentStatus;

  @ApiProperty({ format: 'uuid' })
  programmeId!: string;

  @ApiProperty()
  programmeTitle!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  percentComplete!: number;

  @ApiProperty({ type: [AiProgrammeProgressModuleDto] })
  modules!: AiProgrammeProgressModuleDto[];
}

export class UpdateAiProgrammeProgressDto {
  @ApiProperty({ example: 'foundations' })
  @IsString()
  @MaxLength(64)
  moduleSlug!: string;

  @ApiProperty({
    enum: ['not_started', 'in_progress', 'completed'],
    example: 'completed',
  })
  @IsEnum(AiProgrammeModuleProgressStatus)
  status!: AiProgrammeModuleProgressStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AiProgrammeCompletionResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ enum: EnrolmentStatus, example: EnrolmentStatus.COMPLETED })
  enrolmentStatus!: EnrolmentStatus;

  @ApiProperty({ format: 'date-time' })
  completedAt!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  summary?: Record<string, unknown> | null;
}
