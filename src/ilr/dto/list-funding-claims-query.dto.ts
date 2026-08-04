import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListFundingClaimsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Show only claims with a discrepancy. The question a finance lead ' +
      'arrives with is "what is wrong", not "list every learner".',
  })
  @IsOptional()
  @IsBooleanString()
  discrepanciesOnly?: string;
}
