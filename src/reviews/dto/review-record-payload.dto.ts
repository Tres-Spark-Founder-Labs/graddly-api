import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SmartGoalDto {
  @ApiProperty()
  @IsString()
  objective!: string;

  @ApiProperty()
  @IsString()
  measurable!: string;

  @ApiProperty()
  @IsString()
  achievable!: string;

  @ApiProperty()
  @IsString()
  relevant!: string;

  @ApiProperty()
  @IsString()
  timeBound!: string;
}

export class WellbeingDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Outcome of a goal agreed at the previous review. */
export enum PreviousGoalOutcome {
  ACHIEVED = 'achieved',
  PARTIALLY_ACHIEVED = 'partially_achieved',
  NOT_ACHIEVED = 'not_achieved',
  CARRIED_FORWARD = 'carried_forward',
}

/**
 * F2.2.3 AC4 — "progress against previous goals".
 *
 * One entry per SMART goal agreed at the last completed review, copied
 * forward when the record is opened. Free text alone could not satisfy this:
 * the point of a twelve-weekly cycle is that each review answers for the one
 * before it, and "we discussed progress" is exactly the sentence an inspector
 * asks a follow-up question about.
 *
 * The objective is denormalised rather than referenced by id. The previous
 * record is a historical document; if it were edited or removed, this review
 * must still show what was actually agreed at the time.
 */
export class PreviousGoalProgressDto {
  @ApiProperty({ description: 'The objective as agreed at the last review.' })
  @IsString()
  objective!: string;

  @ApiProperty({ enum: PreviousGoalOutcome })
  @IsEnum(PreviousGoalOutcome)
  outcome!: PreviousGoalOutcome;

  @ApiPropertyOptional({ description: 'Evidence or explanation.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewRecordPayloadDto {
  @ApiProperty({ type: [SmartGoalDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmartGoalDto)
  smartGoals!: SmartGoalDto[];

  /**
   * Optional because a learner's first review has nothing to look back on —
   * required would make the first review of every apprenticeship impossible
   * to submit.
   */
  @ApiPropertyOptional({ type: [PreviousGoalProgressDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviousGoalProgressDto)
  previousGoalProgress?: PreviousGoalProgressDto[];

  /**
   * F2.2.3 AC4 — "OTJ discussion". A named field rather than a line in the
   * progress summary: off-the-job hours are a funding-compliance matter, and
   * an inspector or auditor asking "was this discussed at review" needs an
   * answer that does not depend on someone having mentioned it in prose.
   */
  @ApiPropertyOptional({
    description:
      'What was discussed about off-the-job hours: pace, shortfall, plan.',
  })
  @IsOptional()
  @IsString()
  otjDiscussion?: string;

  @ApiProperty({ type: WellbeingDto })
  @ValidateNested()
  @Type(() => WellbeingDto)
  wellbeing!: WellbeingDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  progressSummary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actionsAgreed?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employerComments?: string;
}
