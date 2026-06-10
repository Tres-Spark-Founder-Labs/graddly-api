import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum } from 'class-validator';

import { EpaOutcome } from '../enums/epa-outcome.enum.js';

export class RecordEpaOutcomeDto {
  @ApiProperty({
    enum: EpaOutcome,
    example: EpaOutcome.PASS,
    description: 'EPA assessment outcome for the apprentice on this enrolment',
  })
  @IsEnum(EpaOutcome)
  outcome!: EpaOutcome;

  @ApiProperty({
    format: 'date',
    example: '2026-06-01',
    description: 'Date the EPA assessment was completed',
  })
  @IsDateString()
  assessedOn!: string;
}
