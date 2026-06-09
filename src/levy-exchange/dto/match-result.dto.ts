import { ApiProperty } from '@nestjs/swagger';

import { MatchScoreBreakdownDto } from './match-score-breakdown.dto.js';

export class MatchResultDto {
  @ApiProperty({ format: 'uuid' })
  donorOrganisationId!: string;

  @ApiProperty({
    description: 'Donor organisation name or "Matched donor" when anonymous',
  })
  donorDisplayName!: string;

  @ApiProperty({ example: '85.50' })
  matchScore!: string;

  @ApiProperty({ type: MatchScoreBreakdownDto })
  scoreBreakdown!: MatchScoreBreakdownDto;

  @ApiProperty({ example: '42000.00' })
  availableSurplus!: string;

  @ApiProperty({ example: '15000.00' })
  transferableAmount!: string;

  @ApiProperty()
  programmeEligible!: boolean;
}
