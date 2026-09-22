import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AuditAction } from '../enums/audit-action.enum.js';
import { AuditExportFormat } from '../enums/audit-export-format.enum.js';

export class AuditExportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AuditExportFormat,
    default: AuditExportFormat.JSON,
  })
  @IsOptional()
  @IsEnum(AuditExportFormat)
  format: AuditExportFormat = AuditExportFormat.JSON;

  @ApiPropertyOptional({ example: 'invitations' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/**
 * The complete export: the same filters as the paginated one, and no paging.
 * Every entry in scope, or an error — never a page of them.
 */
export class AuditCompleteExportQueryDto {
  @ApiPropertyOptional({
    enum: AuditExportFormat,
    default: AuditExportFormat.JSON,
  })
  @IsOptional()
  @IsEnum(AuditExportFormat)
  format: AuditExportFormat = AuditExportFormat.JSON;

  @ApiPropertyOptional({ example: 'invitations' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Inclusive lower bound on createdAt.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.999Z',
    description: 'Inclusive upper bound on createdAt.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AuditLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  actorUserId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  organisationId!: string | null;

  @ApiProperty()
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  entityId!: string;

  @ApiProperty({ enum: AuditAction })
  action!: AuditAction;

  @ApiProperty({ type: 'object', additionalProperties: true })
  changes!: Record<string, { from?: unknown; to?: unknown }>;
}

export class AuditCompleteExportFiltersDto {
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;

  @ApiProperty({ type: String, nullable: true })
  to!: string | null;

  @ApiProperty({ type: String, nullable: true })
  entityType!: string | null;

  @ApiProperty({ enum: AuditAction, nullable: true })
  action!: AuditAction | null;
}

/**
 * A complete audit export states its own scope — whose entries, which range,
 * how many, when — so the file is checkable by whoever it is handed to.
 * `total` is the number of entries in `entries`, read in one statement.
 */
export class AuditCompleteExportDto {
  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'date-time' })
  exportedAt!: string;

  @ApiProperty({ type: AuditCompleteExportFiltersDto })
  filters!: AuditCompleteExportFiltersDto;

  @ApiProperty({ example: 1234 })
  total!: number;

  @ApiProperty({ type: [AuditLogEntryDto] })
  entries!: AuditLogEntryDto[];
}
