import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

/**
 * F1.1.4 AC2 — filters for browsing SME transfer recipients.
 *
 * Every filter is optional so the directory can also simply be browsed, which
 * is the other half of what the requirement asks for ("search or browse").
 *
 * Each filter is compared exactly, because matching compares these same
 * fields exactly — see `LevyRecipientProfileService.searchDirectory`. Values
 * come from GET /levy-exchange/vocabulary, which is what makes an exact filter
 * usable: the donor picks the value a recipient's profile was written with
 * rather than typing it a second time. The examples below are vocabulary
 * values for that reason — the old ones (`manufacturing`, `standards`) now
 * match nothing, and an example is what a client copies.
 */
export class SearchRecipientDirectoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'Engineering & Manufacturing',
    description:
      'Filter by SME sector, compared exactly. An open vocabulary field: ' +
      'GET /levy-exchange/vocabulary open.sector carries the suggestions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({
    example: 'West Midlands',
    description:
      'Filter by SME region, compared exactly. A closed vocabulary field: ' +
      'GET /levy-exchange/vocabulary closed.region carries every value a ' +
      'stored profile can hold.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({
    example: 'ST0415 Software Developer',
    description:
      'Filter by apprenticeship programme type, compared exactly. An open ' +
      'vocabulary field: GET /levy-exchange/vocabulary open.programmeType ' +
      'carries the suggestions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  programmeType?: string;
}
