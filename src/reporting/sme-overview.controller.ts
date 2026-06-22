import { Controller, Get, UseGuards } from '@nestjs/common';
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import {
  SmeApprenticeRowDto,
  SmeOverviewResponseDto,
  SmeOverviewSummaryDto,
  SmePendingOtjApprovalDto,
} from './dto/sme-overview-response.dto.js';
import { SmeOverviewService } from './sme-overview.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(
  SmeOverviewResponseDto,
  SmeOverviewSummaryDto,
  SmePendingOtjApprovalDto,
  SmeApprenticeRowDto,
)
@Controller({ path: 'reporting/sme-overview', version: '1' })
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
  description: 'Requires Flow portal organisation',
  type: ErrorResponseDto,
})
export class SmeOverviewController {
  constructor(private readonly smeOverviewService: SmeOverviewService) {}

  @Get()
  @ResponseMessage('SME overview retrieved successfully')
  @ApiOperation({
    summary: 'FlowPortal SME dashboard aggregate',
    description:
      'PRD F4.3 — mobile-friendly aggregate for the active Flow (SME) organisation: active apprentice count, ' +
      'pending OTJ approvals, reviews due this calendar month, commitment pipeline breakdown, capped pending OTJ list, ' +
      'and apprentice rows with OTJ % and status badges. Flow portal only.',
  })
  @ApiOkResponse({
    description: 'SME dashboard overview',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SmeOverviewResponseDto) },
      },
    },
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.smeOverviewService.getOverview(user.organisationId!);
  }
}
