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
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assignedOwnerUserId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  targetCompletionDate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  eifCriterionSlug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  evidenceNotes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceAttachmentKeys?: string[];

  @ApiPropertyOptional({ enum: QipActionStatus })
  @IsOptional()
  @IsEnum(QipActionStatus)
  status?: QipActionStatus;
}
