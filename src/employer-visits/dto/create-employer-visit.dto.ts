import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { EmployerVisitType } from '../enums/employer-visit-type.enum.js';

/**
 * F2.4.2 AC1 — "visit log entry includes: date, visit type, attendees,
 * discussion points, action points, next visit date".
 */
export class CreateEmployerVisitDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  employerOrganisationId!: string;

  @ApiProperty({ format: 'date', example: '2026-08-03' })
  @IsDateString()
  visitedOn!: string;

  @ApiProperty({ enum: EmployerVisitType })
  @IsEnum(EmployerVisitType)
  visitType!: EmployerVisitType;

  @ApiProperty({
    description:
      'Who was there, as free text — most attendees are not platform users.',
    example: 'Sarah Patel (Operations Manager), Tom Reid (tutor)',
    maxLength: 1000,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  attendees!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  discussionPoints!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  actionPoints?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'Optional. A guessed date on an Ofsted evidence record is worse than an ' +
      'honest blank; GET /employer-visits/next-visit-suggestion offers one.',
  })
  @IsOptional()
  @IsDateString()
  nextVisitDate?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'AC2 — enrolments discussed. Each must be with this employer, not merely ' +
      'belong to this provider.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  enrolmentIds?: string[];
}
