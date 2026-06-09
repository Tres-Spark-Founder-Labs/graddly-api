import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { QipActionStatus } from '../enums/qip-action-status.enum.js';

export class ListQipActionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: QipActionStatus,
    description:
      'Filter by stored status (overdue is computed separately on read).',
  })
  @IsOptional()
  @IsEnum(QipActionStatus)
  status?: QipActionStatus;

  @ApiPropertyOptional({
    description: 'Filter by EIF criterion slug from GET /ofsted/eif-criteria.',
    example: 'leadership_management',
  })
  @IsOptional()
  @IsString()
  eifCriterionSlug?: string;

  @ApiPropertyOptional({
    description:
      'When true, return only actions whose targetCompletionDate is before today and status is not completed.',
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdue?: boolean;
}
