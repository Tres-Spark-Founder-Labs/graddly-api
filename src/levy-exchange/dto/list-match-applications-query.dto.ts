import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

export enum MatchApplicationRoleFilter {
  DONOR = 'donor',
  RECIPIENT = 'recipient',
}

export class ListMatchApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MatchApplicationRoleFilter })
  @IsOptional()
  @IsEnum(MatchApplicationRoleFilter)
  role?: MatchApplicationRoleFilter;

  @ApiPropertyOptional({ enum: LevyMatchApplicationStatus })
  @IsOptional()
  @IsEnum(LevyMatchApplicationStatus)
  status?: LevyMatchApplicationStatus;
}
