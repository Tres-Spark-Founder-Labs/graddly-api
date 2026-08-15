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

import { DonorAnalyticsService } from './donor-analytics.service.js';
import {
  DonorAnalyticsBreakdownDto,
  DonorAnalyticsBreakdownRowDto,
  DonorAnalyticsSummaryDto,
  DonorEsgImpactDto,
} from './dto/donor-analytics-response.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F4.1.4 — Donor Analytics Portal.
 *
 * Scoped to the active organisation as donor. There is no `donorId` parameter
 * by design: a donor may only ever see their own figures, and an id in the URL
 * is an invitation to try someone else's.
 */
@ApiTags('Reporting')
@ApiExtraModels(
  DonorAnalyticsSummaryDto,
  DonorAnalyticsBreakdownDto,
  DonorAnalyticsBreakdownRowDto,
  DonorEsgImpactDto,
)
@Controller({ path: 'reporting/donor-analytics', version: '1' })
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
  description: 'No active organisation context',
  type: ErrorResponseDto,
})
export class DonorAnalyticsController {
  constructor(private readonly donorAnalytics: DonorAnalyticsService) {}

  @Get()
  @ResponseMessage('Donor analytics retrieved successfully')
  @ApiOperation({
    summary: 'Donor analytics summary (F4.1.4 AC1)',
    description:
      'Total transferred, SMEs funded, learners funded, completion rate and ' +
      'EPA pass rate — the last two computed over the enrolments this donor ' +
      'funded, not the recipients’ whole cohorts. `esgImpact` (AC3) is ' +
      'always null pending an agreed methodology.',
  })
  @ApiOkResponse({
    description: 'Donor analytics summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorAnalyticsSummaryDto) },
      },
    },
  })
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DonorAnalyticsSummaryDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorAnalytics.getSummary(user.organisationId!);
  }

  @Get('breakdown')
  @ResponseMessage('Donor analytics breakdown retrieved successfully')
  @ApiOperation({
    summary: 'Transferred amount by sector, region and programme (F4.1.4 AC2)',
    description:
      'Sector and region come from each recipient’s profile and are read ' +
      'live, so a recipient editing its profile changes historical ' +
      'groupings. Transfers with no usable programme detail are grouped as ' +
      '"Unspecified" rather than dropped, so the parts sum to the whole.',
  })
  @ApiOkResponse({
    description: 'Breakdowns',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorAnalyticsBreakdownDto) },
      },
    },
  })
  getBreakdown(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DonorAnalyticsBreakdownDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorAnalytics.getBreakdown(user.organisationId!);
  }
}
