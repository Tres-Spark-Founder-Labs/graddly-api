import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import {
  AuditExportService,
  type AuditExportCsvResult,
} from './audit-export.service.js';
import {
  AuditExportQueryDto,
  AuditLogEntryDto,
} from './dto/audit-export-query.dto.js';
import { AuditExportFormat } from './enums/audit-export-format.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PaginatedResult } from '../common/pagination/paginated-result.js';
import type { Response } from 'express';

function isCsvResult(
  result: PaginatedResult<AuditLogEntryDto> | AuditExportCsvResult,
): result is AuditExportCsvResult {
  return 'csv' in result;
}

@ApiTags('Audit')
@ApiExtraModels(AuditLogEntryDto, PaginationMetaDto)
@Controller({ path: 'audit', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard, CapabilityGuard)
@RequiresCapability(Capability.READ_AUDIT_TRAIL)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active organisation UUID (optional override)',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Insufficient permissions or no active organisation',
  type: ErrorResponseDto,
})
export class AuditController {
  constructor(private readonly auditExportService: AuditExportService) {}

  @Get('export')
  @ResponseMessage('Audit log export retrieved successfully')
  @ApiOperation({ summary: 'Export paginated audit log entries (JSON or CSV)' })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description: 'Paginated audit log entries (JSON envelope) or CSV file',
    schema: {
      oneOf: [
        {
          properties: {
            message: { type: 'string' },
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(AuditLogEntryDto) },
            },
            meta: { $ref: getSchemaPath(PaginationMetaDto) },
          },
        },
        { type: 'string', format: 'binary' },
      ],
    },
  })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaginatedResult<AuditLogEntryDto> | string> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);

    const result = await this.auditExportService.export(user, query);

    if (query.format === AuditExportFormat.CSV && isCsvResult(result)) {
      const organisationId = user.organisationId ?? 'unknown';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-export-${organisationId}-page-${query.page}.csv"`,
      );
      res.setHeader('X-Total-Count', String(result.meta.total));
      res.setHeader('X-Page', String(result.meta.page));
      res.setHeader('X-Per-Page', String(result.meta.perPage));
      return result.csv;
    }

    if (isCsvResult(result)) {
      throw new Error('Unexpected CSV result for JSON export');
    }

    return result;
  }
}
