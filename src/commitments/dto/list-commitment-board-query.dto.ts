import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { CommitmentStatementStatus } from '../enums/commitment-statement-status.enum.js';

/** F1.3.1 AC4 — "employer can filter by status, provider, and standard". */
export class ListCommitmentBoardQueryDto {
  @ApiPropertyOptional({
    enum: CommitmentStatementStatus,
    description: 'Statement status, not per-party signature status.',
  })
  @IsOptional()
  @IsEnum(CommitmentStatementStatus)
  status?: CommitmentStatementStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  providerOrganisationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  standardId?: string;

  @ApiPropertyOptional({
    description:
      'Only statements the employer can sign right now (AC3). Backs the ' +
      '"requiring action" view without the client re-deriving it.',
  })
  @IsOptional()
  actionRequiredOnly?: boolean;
}
