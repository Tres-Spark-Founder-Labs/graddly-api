import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LevyRoiFundingSummaryDto } from '../../das/dto/das-funding-payment-response.dto.js';
import { LevySurplusResponseDto } from '../../levy-exchange/dto/levy-surplus-response.dto.js';

export class LevyRoiForecastSliceDto {
  @ApiProperty({ example: 12 })
  horizonMonths!: number;

  @ApiProperty({ example: 5 })
  activeEnrolmentCount!: number;

  @ApiProperty({
    example: 12500.5,
    description: 'Projected monthly levy spend from active apprenticeships',
  })
  projectedMonthlySpend!: number;

  @ApiProperty({
    example: 45000,
    description: 'Projected completion payment liability',
  })
  projectedCompletionLiability!: number;

  @ApiProperty({
    nullable: true,
    example: 8.5,
    description: 'Estimated runway in months at current burn rate',
  })
  estimatedRunwayMonths!: number | null;
}

export class LevyRoiMonthlyContributionDto {
  @ApiProperty({ example: '2026-01', description: 'Month key (YYYY-MM)' })
  month!: string;

  @ApiProperty({ example: 15000 })
  amount!: number;
}

/** F1.4.1 AC3 — one 12-month window of the year-on-year comparison. */
export class LevyRoiPeriodDto {
  @ApiProperty({ example: '2025-08 to 2026-07' })
  label!: string;

  @ApiProperty({ format: 'date-time' })
  from!: string;

  @ApiProperty({ format: 'date-time' })
  to!: string;

  @ApiProperty({ example: 14, description: 'Enrolments activated in period' })
  starts!: number;

  @ApiProperty({ example: 8, description: 'Enrolments completed in period' })
  completions!: number;

  @ApiProperty({ example: 2, description: 'Enrolments cancelled in period' })
  withdrawals!: number;

  @ApiProperty({
    example: 182000,
    description: 'Levy spend drawn from monthly DAS history for these months',
  })
  levySpend!: number;

  @ApiProperty({ nullable: true, example: 18500 })
  averageCostPerCompletion!: number | null;

  @ApiProperty({
    nullable: true,
    example: 87.5,
    description: 'Null when nothing was assessed in the period',
  })
  epaPassRate!: number | null;
}

export class LevyRoiYearOnYearDto {
  @ApiProperty({ type: LevyRoiPeriodDto })
  currentPeriod!: LevyRoiPeriodDto;

  @ApiProperty({
    type: LevyRoiPeriodDto,
    nullable: true,
    description:
      'Null when no prior-year data exists. Not a zeroed period — the ' +
      'distinction between "no activity" and "no records" matters on a ' +
      'board report.',
  })
  priorPeriod!: LevyRoiPeriodDto | null;

  @ApiProperty({
    example: true,
    description:
      'False for organisations less than two years live, or before the ' +
      'monthly levy history has accumulated. Every delta below is null when ' +
      'this is false.',
  })
  hasPriorPeriodData!: boolean;

  @ApiProperty({ nullable: true, example: 16.67 })
  startsChangePercent!: number | null;

  @ApiProperty({ nullable: true, example: -12.5 })
  completionsChangePercent!: number | null;

  @ApiProperty({ nullable: true, example: 8.4 })
  levySpendChangePercent!: number | null;

  @ApiProperty({
    nullable: true,
    example: 4.5,
    description:
      'Percentage *points*, not percent: 50% → 75% is +25 points. Rates are ' +
      'read as point movements on a board report.',
  })
  epaPassRatePointChange!: number | null;
}

export class LevyRoiReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({
    example: 250000,
    description:
      'Spend proxy: latest DAS balance plus confirmed outbound transfer amounts (v1 stub until contribution history exists)',
  })
  totalLevySpendToDate!: number;

  @ApiProperty({
    nullable: true,
    example: 120000,
    description: 'Latest synced DAS levy balance',
  })
  availableBalance!: number | null;

  @ApiProperty({ nullable: true, example: 'GBP' })
  currency!: string | null;

  @ApiProperty({
    nullable: true,
    example: 68.5,
    description:
      'Annualised projected spend as a percentage of available balance plus annualised spend',
  })
  utilisationPercent!: number | null;

  @ApiProperty({ type: LevyRoiForecastSliceDto })
  forecast!: LevyRoiForecastSliceDto;

  @ApiProperty({
    type: [LevySurplusResponseDto],
    description: 'Per linked donor account; empty when no donor links exist',
  })
  surplusSummary!: LevySurplusResponseDto[];

  @ApiProperty({ example: 12 })
  activeApprenticeCount!: number;

  @ApiProperty({ example: 8 })
  completionCount!: number;

  @ApiProperty({
    nullable: true,
    example: 18500,
    description: 'Average agreed price on completed enrolments',
  })
  averageCostPerCompletion!: number | null;

  /**
   * F1.4.1 AC1. Previously a hardcoded null described as "reserved until EPA
   * outcomes entity exists" — long after `epa_outcomes` was built and had a
   * recording endpoint. Merit and distinction count as passes.
   */
  @ApiProperty({
    nullable: true,
    example: 87.5,
    description:
      '% of assessed apprentices who passed (pass, merit or distinction). ' +
      'Null when no EPA outcome has been recorded yet — not zero.',
  })
  epaPassRate!: number | null;

  @ApiProperty({
    example: 8,
    description: 'How many apprentices the pass rate is calculated from',
  })
  epaAssessedCount!: number;

  @ApiProperty({
    example: 40000,
    description:
      'v1 estimate: completionCount × productivity uplift factor (see docs/reporting.md)',
  })
  estimatedProductivityUplift!: number;

  @ApiProperty({
    type: [LevyRoiMonthlyContributionDto],
    description:
      'Placeholder until DAS monthly contribution history is available',
  })
  monthlyContributions!: LevyRoiMonthlyContributionDto[];

  @ApiProperty({ type: LevyRoiFundingSummaryDto })
  fundingSummary!: LevyRoiFundingSummaryDto;

  @ApiProperty({ type: LevyRoiYearOnYearDto })
  yearOnYear!: LevyRoiYearOnYearDto;

  @ApiProperty({
    format: 'date-time',
    description: 'When this report snapshot was generated',
  })
  generatedAt!: string;
}

export class LevyRoiBreakdownEntryResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Provider organisation id or standard id depending on groupBy',
  })
  groupId!: string;

  @ApiProperty({
    example: 'Northstar Training Ltd',
    description: 'Provider name or standard title',
  })
  label!: string;

  @ApiPropertyOptional({
    example: 'ST0123',
    description: 'Standard code when groupBy=standard',
  })
  code?: string;

  @ApiProperty({ example: 4 })
  activeApprenticeCount!: number;

  @ApiProperty({ example: 2 })
  completionCount!: number;

  @ApiProperty({ nullable: true, example: 19250 })
  averageCostPerCompletion!: number | null;

  @ApiProperty({
    nullable: true,
    example: 72.5,
    description: 'Average OTJ % across enrolments in this group',
  })
  averageOtjPercent!: number | null;

  @ApiProperty({
    nullable: true,
    example: 88,
    description:
      '% of reviews due to date that reached completed status. Null when no reviews are due yet.',
  })
  reviewComplianceRate!: number | null;

  @ApiProperty({
    nullable: true,
    example: 4.5,
    description:
      '% of all enrolments in this group (any status) where the apprentice withdrew or the enrolment was cancelled.',
  })
  withdrawalRate!: number | null;

  /**
   * F1.4.1 AC2 — "compares outcomes across providers and standards side by
   * side". EPA pass rate is the outcome measure AC1 names, so comparing
   * providers without it compares everything except whether apprentices
   * actually passed.
   */
  @ApiProperty({
    nullable: true,
    example: 92.3,
    description:
      '% of assessed apprentices in this group who passed. Null when none ' +
      'have been assessed yet.',
  })
  epaPassRate!: number | null;

  @ApiProperty({
    example: 3,
    description:
      'Assessments behind the rate. A 100% pass rate from one apprentice is ' +
      'not comparable to one from thirty, and a side-by-side table has to ' +
      'say so.',
  })
  epaAssessedCount!: number;
}
