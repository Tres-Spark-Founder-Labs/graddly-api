import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { LevyRoiBreakdownGroup } from '../enums/levy-roi-breakdown-group.enum.js';

export class ListLevyRoiBreakdownQueryDto {
  @ApiPropertyOptional({
    enum: LevyRoiBreakdownGroup,
    default: LevyRoiBreakdownGroup.PROVIDER,
    description: 'Dimension for side-by-side ROI breakdown (F1.4.1)',
  })
  @IsOptional()
  @IsEnum(LevyRoiBreakdownGroup)
  groupBy: LevyRoiBreakdownGroup = LevyRoiBreakdownGroup.PROVIDER;
}

export class ListEmployerDirectoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'London',
    description:
      'Filter by employer organisation city (case-insensitive contains)',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    description: 'Minimum active learner count per employer row',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minActiveLearners?: number;

  @ApiPropertyOptional({
    example: 50,
    minimum: 0,
    maximum: 100,
    description: 'Minimum average OTJ % across active learners',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minAverageOtjPercent?: number;
}
