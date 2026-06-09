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
import { RecipientProfileResponseDto } from '../dto/recipient-profile-response.dto.js';
import { UpsertRecipientProfileDto } from '../dto/upsert-recipient-profile.dto.js';
import { LevyRecipientProfileService } from '../services/levy-recipient-profile.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(RecipientProfileResponseDto, UpsertRecipientProfileDto)
@Controller({ path: 'levy-exchange/recipient-profile', version: '1' })
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
export class RecipientProfileController {
  constructor(
    private readonly recipientProfileService: LevyRecipientProfileService,
  ) {}

  @Put()
  @ResponseMessage('Recipient profile saved successfully')
  @ApiOperation({
    summary: 'Create or update levy recipient profile',
    description:
      'Upserts the active organisation levy recipient profile used by matching. ' +
      'Required before POST /levy-exchange/matches/search.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid sector, region, or programme type value',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Recipient profile',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RecipientProfileResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertRecipientProfileDto,
  ): Promise<RecipientProfileResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.recipientProfileService.upsert(user.organisationId!, dto);
  }

  @Get()
  @ResponseMessage('Recipient profile retrieved successfully')
  @ApiOperation({
    summary: 'Get levy recipient profile for active organisation',
  })
  @ApiOkResponse({
    description: 'Recipient profile',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(RecipientProfileResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Recipient profile not found',
    type: ErrorResponseDto,
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecipientProfileResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.recipientProfileService.get(user.organisationId!);
  }
}
