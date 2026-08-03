import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * F2.2.4 AC3 — flag an off-the-job entry for discussion.
 *
 * The note is required. A flag with no reason is an accusation the learner
 * cannot answer, and the tutor who raised it will not remember why in three
 * weeks either.
 */
export class FlagOtjLogEntryDto {
  @ApiProperty({
    description: 'Why this entry needs a conversation.',
    example: 'Eight hours logged for a day marked as annual leave.',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note!: string;
}
