import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * F2.2.5 AC2 — "caseload dashboard shows: learner count per tutor, at-risk
 * count per tutor, review compliance rate per tutor".
 */
export class TutorCaseloadEntryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Null for the unassigned row. Learners with no tutor are the most ' +
      'urgent caseload problem a manager has, so they are reported rather ' +
      'than filtered out.',
  })
  tutorUserId!: string | null;

  @ApiProperty({ example: 'Tom Reid' })
  tutorName!: string;

  @ApiProperty({ description: 'Active learners assigned to this tutor.' })
  learnerCount!: number;

  @ApiProperty({
    description:
      'Learners the intervention queue considers at risk — the same ' +
      'severity scoring, so the two screens cannot disagree.',
  })
  atRiskCount!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      "Percentage of this tutor's reviews that are not overdue. Null when " +
      'they have no reviews scheduled at all, which is different from 100%.',
  })
  reviewComplianceRate!: number | null;

  @ApiProperty({
    description:
      'True when atRiskCount exceeds the configured threshold (AC3).',
  })
  exceedsAtRiskThreshold!: boolean;
}

export class TutorCaseloadResponseDto {
  @ApiProperty({ type: [TutorCaseloadEntryDto] })
  tutors!: TutorCaseloadEntryDto[];

  @ApiProperty({
    description:
      'The at-risk count above which a tutor is flagged. Returned so the ' +
      'screen states the rule rather than hardcoding a number that can drift ' +
      'from the server.',
  })
  atRiskThreshold!: number;

  @ApiProperty({ description: 'Active learners across all tutors.' })
  totalLearners!: number;

  @ApiProperty()
  totalAtRisk!: number;
}
