import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { OtjActivityCategory } from '../enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../enums/otj-log-status.enum.js';

export class ListOtjLogEntriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OtjLogStatus })
  @IsOptional()
  @IsEnum(OtjLogStatus)
  status?: OtjLogStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  apprenticeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  enrolmentId?: string;

  @ApiPropertyOptional({
    enum: OtjActivityCategory,
    description: 'Filter by OTJ activity type (not programme/course).',
  })
  @IsOptional()
  @IsEnum(OtjActivityCategory)
  category?: OtjActivityCategory;

  @ApiPropertyOptional({ format: 'date' })
  @Type(() => String)
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @Type(() => String)
  @IsOptional()
  @IsDateString()
  to?: string;
}
