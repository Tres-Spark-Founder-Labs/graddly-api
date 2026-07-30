import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

/**
 * F1.1.4 AC2 — filters for browsing SME transfer recipients.
 *
 * Every filter is optional so the directory can also simply be browsed, which
 * is the other half of what the requirement asks for ("search or browse").
 */
export class SearchRecipientDirectoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'manufacturing',
    description: 'Filter by SME sector',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({
    example: 'West Midlands',
    description: 'Filter by SME region',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({
    example: 'standards',
    description: 'Filter by apprenticeship programme type',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  programmeType?: string;
}
