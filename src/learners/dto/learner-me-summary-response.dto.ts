import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';

export class LearnerMeSummaryOtjPaceDto {
  @ApiPropertyOptional({ enum: OtjPaceAlertLevel, nullable: true })
  alertLevel!: OtjPaceAlertLevel | null;

  @ApiProperty({ example: 42.5 })
  otjPercent!: number | null;

  /**
   * P0-A — the three components D2 asks for, plus rejected.
   *
   * Naming, casing and nullability follow `approvedMinutes` exactly: camelCase,
   * `@ApiProperty` (so `required`), plain non-nullable numbers. A minute count
   * genuinely cannot be unknown — the query returns `COALESCE(..., 0)` — which
   * is why these are not nullable while `otjPercent` above is: that one *can*
   * be unknown, when the programme has no planned duration.
   *
   * There is deliberately **no combined total**. D2 makes approved the
   * authoritative figure and requires pending to be shown separately, so a
   * merged field would have no consumer and would only invite one.
   */
  @ApiProperty({
    example: 1200,
    description:
      'Approved only. The authoritative figure (client decision D2) and the ' +
      'one the 15%/30% risk thresholds are evaluated against.',
  })
  approvedMinutes!: number;

  @ApiProperty({
    example: 1890,
    description:
      'Every non-deleted entry at any status, drafts included. Draft minutes ' +
      'are therefore derivable as loggedMinutes minus the other three.',
  })
  loggedMinutes!: number;

  @ApiProperty({
    example: 600,
    description:
      'Submitted and awaiting a decision. Never merged into approvedMinutes ' +
      'and never hidden (D2): a learner who logs hours and sees nothing change ' +
      'concludes the app is broken and stops logging.',
  })
  pendingMinutes!: number;

  @ApiProperty({
    example: 90,
    description:
      'Sent back by the provider. Counted in loggedMinutes, excluded from ' +
      'pendingMinutes and approvedMinutes.',
  })
  rejectedMinutes!: number;
}

export class LearnerMeSummaryResponseDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  activeEnrolmentId!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Apprentice record id for the active enrolment',
  })
  activeApprenticeId!: string | null;

  @ApiPropertyOptional({
    example: 'Software Developer Standard',
    nullable: true,
  })
  programmeTitle!: string | null;

  @ApiPropertyOptional({ enum: EnrolmentStatus, nullable: true })
  enrolmentStatus!: EnrolmentStatus | null;

  @ApiProperty({ type: LearnerMeSummaryOtjPaceDto })
  otjPace!: LearnerMeSummaryOtjPaceDto;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  nextReviewDate!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Days until EPA; null when EPA date unset',
  })
  daysToEpa!: number | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  epaDate!: string | null;
}
