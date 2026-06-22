import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListDasFundingPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class DasFundingPaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  paymentDate!: string;

  @ApiProperty({ example: 1250.5 })
  amount!: number;

  @ApiProperty({ example: 'GBP' })
  currency!: string;

  @ApiPropertyOptional({ example: '2025-26-P01' })
  fundingPeriod!: string | null;

  @ApiPropertyOptional()
  clawbackNotice!: string | null;

  @ApiProperty()
  externalReference!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  enrolmentId!: string | null;
}

export class LevyRoiFundingSummaryDto {
  @ApiProperty({ example: 45000 })
  totalReceived!: number;

  @ApiProperty({ nullable: true, format: 'date' })
  lastPaymentDate!: string | null;

  @ApiProperty({ example: 0 })
  pendingClawbackCount!: number;

  @ApiProperty({ example: 'GBP' })
  currency!: string;
}
