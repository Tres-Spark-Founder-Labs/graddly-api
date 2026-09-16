import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One ISO week. Approved and pending are distinct, never summed (D2). */
export class LearnerOtjWeeklyBucketDto {
  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Monday of the ISO week, YYYY-MM-DD.',
  })
  weekStart!: string;

  @ApiProperty({
    description:
      'Approved off-the-job minutes logged in the week. The authoritative figure.',
  })
  approvedMinutes!: number;

  @ApiProperty({
    description:
      'Submitted minutes awaiting a decision. Shown separately from approved, ' +
      'never merged into it. Draft and rejected entries are in neither.',
  })
  pendingMinutes!: number;
}

/**
 * F1.2.2 AC3 — weekly logged hours over the programme lifetime, grouped by
 * the database rather than by the client. Follows the apprentice portal's
 * own chart: Monday-start weeks, every week in range present, approved and
 * pending kept apart.
 */
export class LearnerOtjWeeklyResponseDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description:
      'The planned programme start the range is anchored to, when recorded.',
  })
  programmeStart!: string | null;

  @ApiProperty({
    type: [LearnerOtjWeeklyBucketDto],
    description:
      'Every ISO week from the earlier of the programme start and the first ' +
      'logged week, to the later of this week and the last logged week. ' +
      'Weeks with no logging are present with zeros.',
  })
  weeks!: LearnerOtjWeeklyBucketDto[];

  @ApiProperty({
    description:
      'True when the range exceeded 520 weeks and the oldest were dropped.',
  })
  truncated!: boolean;
}
