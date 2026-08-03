import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * F2.2.4 AC6 — start a break in learning.
 *
 * `reason` is required. A break with no stated reason is not a record of
 * anything, and it is the first thing an ESFA audit asks about a gap in
 * delivery.
 */
export class RecordBreakInLearningDto {
  @ApiProperty({
    description: 'Why the learner is taking a break.',
    example: 'Long-term sickness absence',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Defaults to today when omitted.',
  })
  @IsOptional()
  @IsDateString()
  startedOn?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      'When the learner is expected back. Optional because it is genuinely ' +
      'unknown for some breaks — a made-up date on a funding record is worse ' +
      'than an honest blank.',
  })
  @IsOptional()
  @IsDateString()
  expectedReturnDate?: string;
}

/** F2.2.4 AC6 — record that the learner has returned. */
export class EndBreakInLearningDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Defaults to today when omitted.',
  })
  @IsOptional()
  @IsDateString()
  actualReturnDate?: string;
}
