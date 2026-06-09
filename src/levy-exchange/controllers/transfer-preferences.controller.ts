import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { TransferPreferencesResponseDto } from '../dto/transfer-preferences-response.dto.js';
import { UpsertTransferPreferencesDto } from '../dto/upsert-transfer-preferences.dto.js';
import { LevyTransferPreferenceService } from '../services/levy-transfer-preference.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(TransferPreferencesResponseDto, UpsertTransferPreferencesDto)
@Controller({ path: 'levy-exchange/transfer-preferences', version: '1' })
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
export class TransferPreferencesController {
  constructor(
    private readonly transferPreferenceService: LevyTransferPreferenceService,
  ) {}

  @Put()
  @ResponseMessage('Transfer preferences saved successfully')
  @ApiOperation({
    summary: 'Create or update donor levy transfer preferences',
    description:
      'Upserts donor matching filters (sectors, regions, size bands, programme types) ' +
      'and caps used by rule-based matching. Donors must also have linked DAS accounts and surplus.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid preference value or maxPerRecipient exceeds available surplus',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Transfer preferences',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(TransferPreferencesResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertTransferPreferencesDto,
  ): Promise<TransferPreferencesResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferPreferenceService.upsert(user.organisationId!, dto);
  }

  @Get()
  @ResponseMessage('Transfer preferences retrieved successfully')
  @ApiOperation({
    summary: 'Get donor levy transfer preferences for active organisation',
  })
  @ApiOkResponse({
    description: 'Transfer preferences',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(TransferPreferencesResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Transfer preferences not found',
    type: ErrorResponseDto,
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransferPreferencesResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.transferPreferenceService.get(user.organisationId!);
  }
}
