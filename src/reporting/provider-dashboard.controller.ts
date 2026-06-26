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
  ProviderDashboardResponseDto,
  ProviderDashboardSummaryDto,
} from './dto/provider-dashboard-response.dto.js';
import { ProviderDashboardService } from './provider-dashboard.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(ProviderDashboardResponseDto, ProviderDashboardSummaryDto)
@Controller({ path: 'reporting/provider-dashboard', version: '1' })
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
  description: 'Requires provider portal organisation',
  type: ErrorResponseDto,
})
export class ProviderDashboardController {
  constructor(
    private readonly providerDashboardService: ProviderDashboardService,
  ) {}

  @Get()
  @ResponseMessage('Provider dashboard retrieved successfully')
  @ApiOperation({
    summary: 'Provider portal dashboard aggregate',
    description:
      'Returns active cohort count, at-risk learner count, EIF overall readiness, ' +
      'and ILR records still in draft for the active provider organisation.',
  })
  @ApiOkResponse({
    description: 'Provider dashboard summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ProviderDashboardResponseDto) },
      },
    },
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.providerDashboardService.getDashboard(user.organisationId!);
  }
}
