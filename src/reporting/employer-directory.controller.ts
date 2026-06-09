import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { EmployerDirectoryEntryResponseDto } from './dto/employer-directory-entry-response.dto.js';
import { ListEmployerDirectoryQueryDto } from './dto/list-reporting-query.dto.js';
import { EmployerDirectoryService } from './employer-directory.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(EmployerDirectoryEntryResponseDto, PaginationMetaDto)
@Controller({ path: 'reporting/employer-directory', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
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
  description: 'Requires provider portal organisation or no active org context',
  type: ErrorResponseDto,
})
export class EmployerDirectoryController {
  constructor(
    private readonly employerDirectoryService: EmployerDirectoryService,
  ) {}

  @Get()
  @ResponseMessage('Employer directory retrieved successfully')
  @ApiOperation({
    summary: 'Paginated employer directory metrics for the active provider',
    description:
      'PRD F2.4.1 — lists linked employers with active learner counts, average OTJ %, ' +
      'commitment pipeline status, and region filters. Provider portal only.',
  })
  @ApiOkResponse({
    description: 'Paginated employer directory',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(EmployerDirectoryEntryResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployerDirectoryQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.employerDirectoryService.list(user.organisationId!, query);
  }
}
