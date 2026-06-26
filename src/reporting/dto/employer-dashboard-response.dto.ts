import { ApiProperty } from '@nestjs/swagger';

import { SmeCommitmentPipelineCountsDto } from './sme-overview-response.dto.js';

export class EmployerDashboardSummaryDto {
  @ApiProperty({ example: 8 })
  activeApprenticeCount!: number;

  @ApiProperty({ example: 3 })
  pendingOtjApprovalCount!: number;

  @ApiProperty({ example: 2 })
  reviewsAwaitingActionCount!: number;

  @ApiProperty({ type: SmeCommitmentPipelineCountsDto })
  commitmentPipeline!: SmeCommitmentPipelineCountsDto;
}

export class EmployerDashboardResponseDto {
  @ApiProperty({ type: EmployerDashboardSummaryDto })
  summary!: EmployerDashboardSummaryDto;
}
