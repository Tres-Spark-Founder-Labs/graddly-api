import { ApiProperty } from '@nestjs/swagger';

export class LevyUtilisationSegmentsDto {
  @ApiProperty({ example: 120000 })
  used!: number;

  @ApiProperty({ example: 45000 })
  expiringWithin90Days!: number;

  @ApiProperty({ example: 80000 })
  available!: number;

  @ApiProperty({ example: 'GBP' })
  currency!: string;
}

export class LevyUtilisationMonthlyPointDto {
  @ApiProperty({ example: '2026-01' })
  month!: string;

  @ApiProperty({ example: 15000 })
  contributions!: number;

  @ApiProperty({ example: 12500 })
  spend!: number;
}

export class LevyCostPerApprenticeRowDto {
  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({ example: 'Software Developer' })
  label!: string;

  @ApiProperty({ enum: ['standard', 'provider'] })
  groupType!: 'standard' | 'provider';

  @ApiProperty({ example: 18500, nullable: true })
  averageCost!: number | null;

  @ApiProperty({ example: 3 })
  apprenticeCount!: number;
}

export class LevyUtilisationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ type: LevyUtilisationSegmentsDto })
  segments!: LevyUtilisationSegmentsDto;

  /**
   * Where the three segments above came from, so a screen never presents a
   * typed figure as one the ESFA sent.
   *
   *   das          parsed from a DAS sync payload
   *   manual       derived from what somebody entered by hand
   *   unavailable  no levy account on record yet, so the segments are zeroes
   *
   * The balance tile already distinguishes "Entered manually" from "DAS
   * synced"; utilisation now carries the same distinction instead of looking
   * synced whatever its origin.
   */
  @ApiProperty({
    enum: ['das', 'manual', 'unavailable'],
    example: 'manual',
    description: 'Provenance of the utilisation segments.',
  })
  segmentsSource!: 'das' | 'manual' | 'unavailable';

  @ApiProperty({ type: [LevyUtilisationMonthlyPointDto] })
  monthlySeries!: LevyUtilisationMonthlyPointDto[];

  @ApiProperty()
  forecast!: {
    horizonMonths: number;
    activeEnrolmentCount: number;
    projectedMonthlySpend: number;
    projectedCompletionLiability: number;
    estimatedRunwayMonths: number | null;
  };

  @ApiProperty({ type: [LevyCostPerApprenticeRowDto] })
  costPerApprentice!: LevyCostPerApprenticeRowDto[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}
