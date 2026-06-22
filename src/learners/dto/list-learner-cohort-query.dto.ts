import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { LearnerStatusBadge } from '../utils/learner-status-badge.util.js';

export class ListLearnerCohortQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by employer organisation',
  })
  @IsOptional()
  @IsUUID()
  employerOrganisationId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by apprenticeship standard',
  })
  @IsOptional()
  @IsUUID()
  standardId?: string;

  @ApiPropertyOptional({
    enum: LearnerStatusBadge,
    description: 'Filter by derived status badge',
  })
  @IsOptional()
  @IsEnum(LearnerStatusBadge)
  statusBadge?: LearnerStatusBadge;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter by assigned tutor user',
  })
  @IsOptional()
  @IsUUID()
  tutorUserId?: string;

  @ApiPropertyOptional({
    description: 'Filter by EPA month (YYYY-MM)',
    example: '2026-09',
  })
  @IsOptional()
  epaMonth?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: [
      'learnerName',
      'employerName',
      'standardTitle',
      'startDate',
      'otjPercent',
      'nextReviewDate',
      'epaDate',
      'statusBadge',
      'tutorName',
    ],
  })
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    default: 'json',
    description: 'Response format; csv returns attachment',
  })
  @IsOptional()
  format?: 'json' | 'csv';
}

export class ListInterventionQueueQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filter queue to a specific tutor caseload',
  })
  @IsOptional()
  @IsUUID()
  tutorUserId?: string;

  @ApiPropertyOptional({
    description:
      'When true, filter to enrolments where current user is the tutor',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;
}
