import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { QipActionStatus } from '../enums/qip-action-status.enum.js';

export class ListQipActionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QipActionStatus })
  @IsOptional()
  @IsEnum(QipActionStatus)
  status?: QipActionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eifCriterionSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdue?: boolean;
}
