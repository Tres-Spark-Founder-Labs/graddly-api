import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({
    nullable: true,
    description: 'Reserved until EPA outcomes entity exists (F1.4.1 stub)',
    example: null,
  })
  epaPassRate!: number | null;

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
}
