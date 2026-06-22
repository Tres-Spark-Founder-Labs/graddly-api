import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { PatchSafeguardingChecklistItemDto } from './dto/patch-safeguarding-checklist-item.dto.js';
import { SafeguardingChecklistItemResponseDto } from './dto/safeguarding-checklist-item-response.dto.js';
import { SafeguardingChecklistService } from './safeguarding-checklist.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Ofsted')
@ApiExtraModels(
  SafeguardingChecklistItemResponseDto,
  PatchSafeguardingChecklistItemDto,
)
@Controller({ path: 'ofsted/safeguarding-checklist', version: '1' })
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
export class SafeguardingChecklistController {
  constructor(
    private readonly safeguardingService: SafeguardingChecklistService,
  ) {}

  @Get()
  @ResponseMessage('Safeguarding checklist retrieved successfully')
  @ApiOperation({
    summary: 'List org safeguarding checklist items',
    description:
      'Returns the four required safeguarding checklist items for the active provider organisation. ' +
      'Items are auto-seeded on first access. Completion state feeds the EIF safeguarding criterion score.',
  })
  @ApiOkResponse({
    description: 'Safeguarding checklist items',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(SafeguardingChecklistItemResponseDto) },
        },
      },
    },
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.safeguardingService.list(user);
  }

  @Patch(':slug')
  @ResponseMessage('Safeguarding checklist item marked complete')
  @ApiOperation({
    summary: 'Mark a safeguarding checklist item complete',
    description:
      'Sets completedAt to now for the given slug. Optionally attach an evidence storage key. ' +
      'Invalidates the EIF score cache for the organisation.',
  })
  @ApiOkResponse({
    description: 'Updated checklist item',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SafeguardingChecklistItemResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Unknown checklist slug',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  markComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: PatchSafeguardingChecklistItemDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.safeguardingService.markComplete(user, slug, dto);
  }
}
