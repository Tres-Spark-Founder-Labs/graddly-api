import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class GenerateSarReportDto {
  /**
   * Matches the ILR convention already used across the platform, so "the
   * 2025-26 SAR" and "the 2025-26 ILR return" mean the same twelve months.
   */
  @ApiProperty({ example: '2025-26', description: 'Academic year, `YYYY-YY`.' })
  @IsString()
  @MaxLength(9)
  @Matches(/^\d{4}-\d{2}$/)
  academicYear!: string;
}
