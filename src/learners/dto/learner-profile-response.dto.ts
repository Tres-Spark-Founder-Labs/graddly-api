import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { MessageThreadSummaryDto } from '../../messaging/dto/message-thread-summary.dto.js';
import { OtjLogStatus } from '../../otj/enums/otj-log-status.enum.js';
import { ReviewStatus } from '../../reviews/enums/review-status.enum.js';

import { LearnerDocumentItemDto } from './learner-document-item.dto.js';
import { InterventionActionResponseDto } from './learner-provider-response.dto.js';

export class LearnerProfilePersonalDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;
}

export class LearnerProfileEmployerDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  organisationId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  organisationName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  managerName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  managerEmail!: string | null;
}

export class LearnerProfileProgrammeDto {
  @ApiProperty()
  standardTitle!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  plannedStartDate!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  plannedEndDate!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  epaDate!: string | null;

  /**
   * F2.2.4 AC1 — "EPA organisation".
   *
   * The profile previously showed when the assessment was and what the
   * outcome had been, and never who was assessing — so a tutor chasing an
   * overdue result had nobody to ring.
   *
   * Null until an EPAO is appointed, which normally happens part-way through
   * rather than at enrolment.
   */
  @ApiPropertyOptional({ type: String, nullable: true })
  epaOrganisationName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'UKPRN as it appears on the ILR.',
  })
  epaOrganisationUkprn!: string | null;
}

export class LearnerProfileTutorDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;
}

export class LearnerProfileReviewItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ReviewStatus })
  status!: ReviewStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt!: string;

  @ApiProperty()
  isOverdue!: boolean;

  @ApiProperty()
  tutorSigned!: boolean;

  @ApiProperty()
  apprenticeSigned!: boolean;
}

export class LearnerProfileOtjEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date' })
  loggedDate!: string;

  @ApiProperty()
  minutes!: number;

  @ApiProperty({ enum: OtjLogStatus })
  status!: OtjLogStatus;

  @ApiProperty({ description: 'What the learner said they did.' })
  activityName!: string;

  /**
   * F2.2.4 AC3 — "tutor can flag entries".
   *
   * A flag is not a rejection. Rejecting is the employer's decision that the
   * hours do not count; flagging keeps the hours and says the session needs a
   * conversation. The profile shows both so a tutor can see, in one list,
   * which sessions they have already queried.
   */
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  flaggedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  flagNote!: string | null;
}

export class LearnerProfileOtjDto {
  @ApiPropertyOptional({ nullable: true })
  otjPercent!: number | null;

  /**
   * Every non-deleted entry on the enrolment, not just the ones returned.
   *
   * F2.2.4 AC3 asks for "all sessions submitted" and AC7 asks for a
   * two-second load. `recentEntries` is capped so one pathological account
   * cannot blow the budget; `totalCount` and `truncated` let the screen say
   * "showing 500 of 812" rather than quietly showing less than it promised.
   */
  @ApiProperty()
  totalCount!: number;

  @ApiProperty({
    description: 'True when the cap bit and recentEntries is not the full log.',
  })
  truncated!: boolean;

  @ApiProperty({ type: [LearnerProfileOtjEntryDto] })
  recentEntries!: LearnerProfileOtjEntryDto[];
}

export class LearnerProfileBreakInLearningDto {
  @ApiProperty()
  active!: boolean;

  @ApiPropertyOptional({ nullable: true })
  reason!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  expectedReturnDate!: string | null;

  @ApiProperty({ type: [InterventionActionResponseDto] })
  recentInterventions!: InterventionActionResponseDto[];
}

export class LearnerProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ type: LearnerProfilePersonalDto })
  personal!: LearnerProfilePersonalDto;

  @ApiProperty({ type: LearnerProfileEmployerDto })
  employer!: LearnerProfileEmployerDto;

  @ApiProperty({ type: LearnerProfileProgrammeDto })
  programme!: LearnerProfileProgrammeDto;

  @ApiProperty({ type: LearnerProfileTutorDto })
  tutor!: LearnerProfileTutorDto;

  @ApiProperty({ type: [LearnerProfileReviewItemDto] })
  reviews!: LearnerProfileReviewItemDto[];

  @ApiProperty({ type: LearnerProfileOtjDto })
  otj!: LearnerProfileOtjDto;

  @ApiProperty({ type: [LearnerDocumentItemDto] })
  documents!: LearnerDocumentItemDto[];

  /**
   * F2.2.4 AC5 — "communication thread with the learner is visible".
   *
   * This was `messageThreadIds: string[]` — a list of UUIDs and nothing else.
   * A screen given only ids cannot show a conversation; it can only show that
   * one exists somewhere. Now each entry carries who the thread is with, how
   * many messages, how many unread, and a preview of the latest, so the panel
   * renders from the profile response alone. Opening a thread still goes to
   * `GET /messaging/threads/:id/messages` for the full history.
   *
   * Only threads the requesting user may read appear here — provider admins
   * see both, a tutor sees their own.
   */
  @ApiProperty({ type: [MessageThreadSummaryDto] })
  messageThreads!: MessageThreadSummaryDto[];

  @ApiProperty({ type: LearnerProfileBreakInLearningDto })
  breakInLearning!: LearnerProfileBreakInLearningDto;
}
