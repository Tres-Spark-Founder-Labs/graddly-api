import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { OtjActivityCategory } from '../enums/otj-activity-category.enum.js';

export class CreateOtjLogEntryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active enrolment for the apprentice on the programme/course this OTJ session relates to. ' +
      'This identifies which course the hours count toward — not the activity type.',
  })
  @IsUUID()
  enrolmentId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Apprentice who performed the OTJ activity. Must match the enrolment apprentice.',
  })
  @IsUUID()
  apprenticeId!: string;

  @ApiProperty({
    maxLength: 80,
    description:
      'Short label for the OTJ session (PRD: activity name). Distinct from optional note.',
    example: 'Shadowing senior engineer on release',
  })
  @IsString()
  @MaxLength(80)
  activityName!: string;

  @ApiProperty({
    enum: OtjActivityCategory,
    description:
      'Type of OTJ activity (PRD category dropdown). Not the programme/course — see enrolmentId. ' +
      'Allowed values are listed at GET /otj-log-entries/categories.',
    example: OtjActivityCategory.JOB_SHADOWING,
  })
  @IsEnum(OtjActivityCategory)
  category!: OtjActivityCategory;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  loggedDate!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Duration of the OTJ session in minutes.',
  })
  @IsInt()
  @Min(1)
  minutes!: number;

  @ApiPropertyOptional({
    description: 'Optional extra commentary beyond activityName.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Optional evidence metadata. When files are included, use storage keys from the upload flow: ' +
      'orgs/{organisationId}/learners/{apprenticeId}/evidence/…',
    example: {
      files: [
        'orgs/660e8400-e29b-41d4-a716-446655440000/learners/660e8400-e29b-41d4-a716-446655440001/evidence/uuid/photo.jpg',
      ],
    },
  })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}
