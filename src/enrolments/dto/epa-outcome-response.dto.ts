import { ApiProperty } from '@nestjs/swagger';

import { EpaOutcome } from '../enums/epa-outcome.enum.js';

export class EpaOutcomeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ enum: EpaOutcome })
  outcome!: EpaOutcome;

  @ApiProperty({ format: 'date', example: '2026-06-01' })
  assessedOn!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the outcome was recorded in Gradlly',
  })
  createdAt!: string;
}
