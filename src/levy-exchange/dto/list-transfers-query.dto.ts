import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

export enum TransferRoleFilter {
  DONOR = 'donor',
  RECIPIENT = 'recipient',
}

export class ListTransfersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransferRoleFilter })
  @IsOptional()
  @IsEnum(TransferRoleFilter)
  role?: TransferRoleFilter;

  @ApiPropertyOptional({ enum: LevyTransferStatus })
  @IsOptional()
  @IsEnum(LevyTransferStatus)
  status?: LevyTransferStatus;
}
