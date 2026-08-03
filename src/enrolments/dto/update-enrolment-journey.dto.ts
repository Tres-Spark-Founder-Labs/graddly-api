import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateEnrolmentJourneyDto {
  @ApiPropertyOptional({
    description: 'Confirmed EPA date (YYYY-MM-DD)',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsDateString()
  epaDate?: string;

  /**
   * F2.2.4 AC1 — the end-point assessment organisation.
   *
   * Sits with `epaDate` because it is decided at the same point in the
   * journey: an EPAO is appointed part-way through, not at enrolment.
   */
  @ApiPropertyOptional({
    description: 'End-point assessment organisation name.',
    example: 'Innovate Awarding',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  epaOrganisationName?: string;

  @ApiPropertyOptional({
    description:
      'EPAO UKPRN — eight digits, as it appears on the ILR. Stored alongside ' +
      'the name because several trading names can map to one registration.',
    example: '10012345',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: 'UKPRN must be exactly 8 digits' })
  epaOrganisationUkprn?: string;
}
