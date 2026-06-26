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
  EmployerDashboardResponseDto,
  EmployerDashboardSummaryDto,
} from './dto/employer-dashboard-response.dto.js';
import { SmeCommitmentPipelineCountsDto } from './dto/sme-overview-response.dto.js';
import { EmployerDashboardService } from './employer-dashboard.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(
  EmployerDashboardResponseDto,
  EmployerDashboardSummaryDto,
  SmeCommitmentPipelineCountsDto,
)
@Controller({ path: 'reporting/employer-dashboard', version: '1' })
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
  description: 'Requires employer portal organisation',
  type: ErrorResponseDto,
})
export class EmployerDashboardController {
  constructor(
    private readonly employerDashboardService: EmployerDashboardService,
  ) {}

  @Get()
  @ResponseMessage('Employer dashboard retrieved successfully')
  @ApiOperation({
    summary: 'Employer portal dashboard aggregate',
    description:
      'Returns active apprentice count, pending OTJ approvals, reviews awaiting employer action, ' +
      'and commitment pipeline breakdown for enrolments linked to the active employer organisation.',
  })
  @ApiOkResponse({
    description: 'Employer dashboard summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EmployerDashboardResponseDto) },
      },
    },
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.employerDashboardService.getDashboard(user.organisationId!);
  }
}
