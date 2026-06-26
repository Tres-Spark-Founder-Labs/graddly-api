import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EifRag } from '../../ofsted/enums/eif-rag.enum.js';

export class ProviderDashboardSummaryDto {
  @ApiProperty({ example: 42 })
  cohortCount!: number;

  @ApiProperty({ example: 5 })
  atRiskCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Overall EIF readiness percent; null when not yet computed',
  })
  eifOverallPercent!: number | null;

  @ApiPropertyOptional({ enum: EifRag, nullable: true })
  eifOverallRag!: EifRag | null;

  @ApiProperty({ example: 3 })
  ilrPendingCount!: number;
}

export class ProviderDashboardResponseDto {
  @ApiProperty({ type: ProviderDashboardSummaryDto })
  summary!: ProviderDashboardSummaryDto;
}
