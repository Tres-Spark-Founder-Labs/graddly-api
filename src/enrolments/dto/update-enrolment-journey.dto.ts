import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class UpdateEnrolmentJourneyDto {
  @ApiPropertyOptional({
    description: 'Confirmed EPA date (YYYY-MM-DD)',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsDateString()
  epaDate?: string;
}
