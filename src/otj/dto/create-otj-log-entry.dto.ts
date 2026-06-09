import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateOtjLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  apprenticeId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  loggedDate!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  minutes!: number;

  @ApiPropertyOptional()
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
