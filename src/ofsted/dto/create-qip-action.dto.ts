import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { QipActionStatus } from '../enums/qip-action-status.enum.js';

export class CreateQipActionDto {
  @ApiProperty({
    maxLength: 255,
    description: 'Short action title shown on the QIP hub.',
  })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({
    description: 'Longer description of the improvement action.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Staff user responsible for the action; must be an active org member.',
  })
  @IsUUID()
  assignedOwnerUserId!: string;

  @ApiProperty({
    format: 'date',
    description:
      'Target completion date (ISO date). Overdue is derived when this is before today.',
    example: '2026-12-31',
  })
  @IsDateString()
  targetCompletionDate!: string;

  @ApiProperty({
    maxLength: 64,
    description: 'EIF criterion slug from GET /ofsted/eif-criteria.',
    example: 'safeguarding',
  })
  @IsString()
  @MaxLength(64)
  eifCriterionSlug!: string;

  @ApiPropertyOptional({
    description: 'Free-text notes about evidence gathered for this action.',
  })
  @IsOptional()
  @IsString()
  evidenceNotes?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Org-scoped storage keys (e.g. from file upload) attached as QIP evidence.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceAttachmentKeys?: string[];

  @ApiPropertyOptional({
    enum: QipActionStatus,
    default: QipActionStatus.NOT_STARTED,
    description: 'Initial status; defaults to not_started.',
  })
  @IsOptional()
  @IsEnum(QipActionStatus)
  status?: QipActionStatus;
}
