import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { REVIEW_BULK_SCHEDULE_MAX } from '../reviews.constants.js';

/**
 * F2.2.3 AC2 — "provider can set review dates for multiple learners
 * simultaneously".
 *
 * The existing `POST /reviews/bulk-schedule` takes full `CreateReviewDto`
 * items, each naming the apprentice, the apprentice's user, the tutor and the
 * employer manager. That is a reasonable contract for one review and an
 * unusable one for thirty: it makes the caller resolve four ids per learner
 * before it can ask for a date. No UI was ever built against it, which is the
 * symptom rather than the cause.
 *
 * Every one of those ids is already on the enrolment. So this variant asks for
 * what the provider actually knows — these learners, this date — and derives
 * the rest. An enrolment missing a participant is reported as a per-learner
 * failure rather than rejecting the batch: scheduling twenty-eight of thirty
 * and being told which two need a tutor assigned is more useful than
 * scheduling none.
 */
export class BulkScheduleFromEnrolmentsDto {
  @ApiProperty({
    description: 'Enrolments to schedule a review for.',
    type: [String],
    maxItems: REVIEW_BULK_SCHEDULE_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REVIEW_BULK_SCHEDULE_MAX)
  @IsUUID('4', { each: true })
  enrolmentIds!: string[];

  @ApiProperty({
    description: 'The same scheduled date and time for every learner.',
    example: '2026-09-15T10:00:00.000Z',
  })
  @IsDateString()
  scheduledAt!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reviewType?: string;
}
