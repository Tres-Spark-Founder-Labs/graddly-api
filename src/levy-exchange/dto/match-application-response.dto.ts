import { ApiProperty } from '@nestjs/swagger';

import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

export class MatchApplicationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  @ApiProperty({ format: 'uuid' })
  recipientOrganisationId!: string;

  @ApiProperty({ example: '15000.00' })
  requestedAmount!: string;

  @ApiProperty({ enum: LevyMatchApplicationStatus })
  status!: LevyMatchApplicationStatus;

  @ApiProperty({ nullable: true, example: '85.50' })
  matchScore!: string | null;

  @ApiProperty({ nullable: true })
  scoreBreakdown!: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
