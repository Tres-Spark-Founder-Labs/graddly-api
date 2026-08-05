import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { FundingClaimResponseDto } from './dto/funding-claim-response.dto.js';
import { ListFundingClaimsQueryDto } from './dto/list-funding-claims-query.dto.js';
import { UpdateFundingClaimResolutionDto } from './dto/update-funding-claim-resolution.dto.js';
import { FundingClaimTrackerService } from './funding-claim-tracker.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.3.2 AC7 — the funding claim tracker.
 *
 * Claimed and received are computed from `enrolments.agreedPrice` and
 * `das_funding_payments` on every read; only the resolution status is stored.
 */
@ApiTags('ILR Funding Claims')
@ApiExtraModels(FundingClaimResponseDto)
@Controller({ path: 'ilr/funding-claims', version: '1' })
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
export class FundingClaimsController {
  constructor(private readonly tracker: FundingClaimTrackerService) {}

  @Get()
  @ResponseMessage('Funding claims retrieved successfully')
  @ApiOperation({
    summary: 'Claimed vs received funding per enrolment, with discrepancies',
  })
  @ApiOkResponse({
    description: 'Amounts are computed on read, never cached',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(FundingClaimResponseDto) },
        },
      },
    },
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFundingClaimsQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.tracker.list(user.organisationId!, query);
    return new PaginatedResult(result.items, result.meta);
  }

  /**
   * Owner/admin only. Writing off a funding shortfall is a financial decision
   * about money the provider will not receive, not a note anyone can leave.
   */
  @Patch(':enrolmentId/resolution')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.RESOLVE_FUNDING_CLAIM)
  @ResponseMessage('Funding claim resolution updated successfully')
  @ApiOperation({ summary: 'Record progress on a funding discrepancy' })
  @ApiOkResponse({
    description: 'The updated claim',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(FundingClaimResponseDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Enrolment not found, or closing a claim without a note explaining why',
    type: ErrorResponseDto,
  })
  async setResolution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Body() dto: UpdateFundingClaimResolutionDto,
  ): Promise<FundingClaimResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.tracker.setResolution(
      user.organisationId!,
      enrolmentId,
      user.id,
      dto,
    );
  }
}
