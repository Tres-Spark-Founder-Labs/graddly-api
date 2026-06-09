import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsObject, IsOptional, IsUUID } from 'class-validator';

import { MatchScoreBreakdownDto } from './match-score-breakdown.dto.js';

export class CreateMatchApplicationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Donor organisation UUID from match search results',
  })
  @IsUUID()
  donorOrganisationId!: string;

  @ApiProperty({
    example: '15000.00',
    description: 'Requested levy transfer amount (GBP)',
  })
  @IsNumberString()
  requestedAmount!: string;

  @ApiPropertyOptional({ example: '85.50' })
  @IsOptional()
  @IsNumberString()
  matchScore?: string;

  @ApiPropertyOptional({ type: MatchScoreBreakdownDto })
  @IsOptional()
  @IsObject()
  scoreBreakdown?: MatchScoreBreakdownDto;
}
