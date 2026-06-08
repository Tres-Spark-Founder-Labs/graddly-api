import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { IlrLearnerRecordStatus } from '../enums/ilr-learner-record-status.enum.js';

export class ListIlrLearnerRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  enrolmentId?: string;

  @ApiPropertyOptional({ example: '2025-10' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  collectionPeriod?: string;

  @ApiPropertyOptional({ enum: IlrLearnerRecordStatus })
  @IsOptional()
  @IsEnum(IlrLearnerRecordStatus)
  status?: IlrLearnerRecordStatus;
}
