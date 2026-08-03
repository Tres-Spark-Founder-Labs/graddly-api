import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { DasApiOperation } from '../enums/das-api-operation.enum.js';

/**
 * F2.3.1 AC7 — filters for the API activity log.
 *
 * `failedOnly` exists because the question a provider actually arrives with is
 * *"what went wrong"*, not *"show me every call"*. A log that can only be read
 * in full is a log nobody reads.
 */
export class ListDasActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: DasApiOperation,
    description: 'Restrict to one DAS operation.',
  })
  @IsOptional()
  @IsEnum(DasApiOperation)
  operation?: DasApiOperation;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Show only calls that failed.',
  })
  @IsOptional()
  @IsBooleanString()
  failedOnly?: string;
}
