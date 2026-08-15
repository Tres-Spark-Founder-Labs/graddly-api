import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * F4.1.4 AC3 — the ESG impact card.
 *
 * Declared but always null until client decision 19 supplies a methodology.
 * It exists in the contract now so that adding it later is an added value
 * rather than a shape change for every consumer, and so the absence is
 * explicit: a missing field reads as "forgot", `null` reads as "not
 * available", and only one of those is true.
 */
export class DonorEsgImpactDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Estimated productivity uplift. Awaiting an agreed formula.',
  })
  productivityUplift!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Social mobility score. Awaiting a defined methodology — see client decision 19.',
  })
  socialMobilityScore!: number | null;
}

export class DonorAnalyticsSummaryDto {
  @ApiProperty({
    example: 48000,
    description:
      'Total transferred to date across confirmed and active transfers.',
  })
  totalTransferred!: number;

  @ApiProperty({
    example: 3,
    description: 'Distinct SMEs that received a confirmed or active transfer.',
  })
  smesFunded!: number;

  @ApiProperty({
    example: 7,
    description:
      'Distinct learners funded. A learner funded by two of this donor’s ' +
      'transfers counts once.',
  })
  learnersFunded!: number;

  @ApiProperty({ example: 2 })
  completedCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 28.57,
    description:
      'Percentage of funded enrolments completed; null when none are funded ' +
      'yet — which is not the same as 0%.',
  })
  completionRate!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 100,
    description:
      'EPA pass rate over funded enrolments; null when none assessed yet. ' +
      'Merit and distinction count as passes.',
  })
  epaPassRate!: number | null;

  @ApiProperty({ example: 2 })
  epaAssessedCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: DonorEsgImpactDto,
    description: 'AC3 — null until a methodology is agreed (decision 19).',
  })
  esgImpact!: DonorEsgImpactDto | null;
}

export class DonorAnalyticsBreakdownRowDto {
  @ApiProperty({ example: 'Engineering & Manufacturing' })
  label!: string;

  @ApiProperty({ example: 21000 })
  amount!: number;
}

export class DonorAnalyticsBreakdownDto {
  @ApiProperty({ type: [DonorAnalyticsBreakdownRowDto] })
  bySector!: DonorAnalyticsBreakdownRowDto[];

  @ApiProperty({ type: [DonorAnalyticsBreakdownRowDto] })
  byRegion!: DonorAnalyticsBreakdownRowDto[];

  @ApiProperty({ type: [DonorAnalyticsBreakdownRowDto] })
  byProgrammeType!: DonorAnalyticsBreakdownRowDto[];
}
