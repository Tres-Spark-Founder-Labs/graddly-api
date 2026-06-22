import { ApiProperty } from '@nestjs/swagger';

import { FundingClaimStatus } from '../enums/funding-claim-status.enum.js';

export class SmeCommitmentPipelineCountsDto {
  @ApiProperty({ example: 2 })
  none!: number;

  @ApiProperty({ example: 1 })
  draft!: number;

  @ApiProperty({ example: 0 })
  awaitingSignatures!: number;

  @ApiProperty({ example: 3 })
  signed!: number;

  @ApiProperty({ example: 0 })
  cancelled!: number;
}

export class SmeOverviewSummaryDto {
  @ApiProperty({ example: 5 })
  activeApprenticeCount!: number;

  @ApiProperty({ example: 2 })
  pendingOtjApprovalCount!: number;

  @ApiProperty({ example: 1 })
  reviewsDueThisMonthCount!: number;

  @ApiProperty({ type: SmeCommitmentPipelineCountsDto })
  commitmentPipeline!: SmeCommitmentPipelineCountsDto;

  @ApiProperty({
    enum: FundingClaimStatus,
    description:
      'Lightweight funding claim status from latest DAS payment sync',
    example: FundingClaimStatus.SYNCED,
  })
  fundingClaimStatus!: FundingClaimStatus;
}

export class SmePendingOtjApprovalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Alex Apprentice' })
  apprenticeName!: string;

  @ApiProperty({ format: 'date' })
  loggedDate!: string;

  @ApiProperty({ example: 120 })
  minutes!: number;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;
}

export class SmeApprenticeRowDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ example: 'Alex Apprentice' })
  learnerName!: string;

  @ApiProperty({ example: 'Software Developer' })
  programmeTitle!: string;

  @ApiProperty({ example: 42.5, nullable: true })
  otjPercent!: number | null;

  @ApiProperty({ format: 'date', nullable: true })
  nextReviewDate!: string | null;

  @ApiProperty({ example: 'on_track' })
  statusBadge!: string;
}

export class SmeOverviewResponseDto {
  @ApiProperty({ type: SmeOverviewSummaryDto })
  summary!: SmeOverviewSummaryDto;

  @ApiProperty({ type: [SmePendingOtjApprovalDto] })
  pendingOtjApprovals!: SmePendingOtjApprovalDto[];

  @ApiProperty({ type: [SmeApprenticeRowDto] })
  apprentices!: SmeApprenticeRowDto[];
}
