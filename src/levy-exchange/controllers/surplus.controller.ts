import { Controller, Get, Post, UseGuards } from '@nestjs/common';
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

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { LevyExpiryCalendarEntryDto } from '../dto/levy-expiry-calendar-entry.dto.js';
import { LevySurplusResponseDto } from '../dto/levy-surplus-response.dto.js';
import { LevySurplusService } from '../services/levy-surplus.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(LevySurplusResponseDto, LevyExpiryCalendarEntryDto)
@Controller({ path: 'levy-exchange/surplus', version: '1' })
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
export class SurplusController {
  constructor(private readonly surplusService: LevySurplusService) {}

  @Get()
  @ResponseMessage('Levy surplus retrieved successfully')
  @ApiOperation({
    summary: 'Get latest levy surplus snapshot per linked donor account',
    description:
      'Returns the most recent computed surplus per linked donor link. ' +
      'Use POST /levy-exchange/surplus/recompute to refresh after DAS sync.',
  })
  @ApiOkResponse({
    description: 'Levy surplus per linked donor account',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LevySurplusResponseDto) },
        },
      },
    },
  })
  getSurplus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LevySurplusResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.surplusService.getSurplus(user.organisationId!);
  }

  @Get('expiry-calendar')
  @ResponseMessage('Levy expiry calendar retrieved successfully')
  @ApiOperation({
    summary: 'Get levy tranche expiry calendar for the next 24 months',
  })
  @ApiOkResponse({
    description: 'Expiry calendar grouped by month',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LevyExpiryCalendarEntryDto) },
        },
      },
    },
  })
  getExpiryCalendar(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LevyExpiryCalendarEntryDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.surplusService.getExpiryCalendar(user.organisationId!);
  }

  @Post('recompute')
  @ResponseMessage('Levy surplus recomputed successfully')
  @ApiOperation({
    summary: 'Recompute levy surplus snapshots for linked donor accounts',
    description:
      'Recalculates surplus using the 50% levy cap, committed spend forecast, ' +
      'and already-confirmed transfers. Requires at least one linked donor account.',
  })
  @ApiBadRequestResponse({
    description: 'No linked donor accounts or forecast data unavailable',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Recomputed levy surplus snapshots',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LevySurplusResponseDto) },
        },
      },
    },
  })
  recompute(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LevySurplusResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.surplusService.recompute(user.organisationId!);
  }
}
