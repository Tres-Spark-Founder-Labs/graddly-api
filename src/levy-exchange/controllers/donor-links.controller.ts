import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
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
import { CreateDonorLinkDto } from '../dto/create-donor-link.dto.js';
import { DonorLinkConsentStartResponseDto } from '../dto/donor-link-consent-start-response.dto.js';
import { DonorLinkResponseDto } from '../dto/donor-link-response.dto.js';
import { DasDonorLinkService } from '../services/das-donor-link.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(
  DonorLinkResponseDto,
  DonorLinkConsentStartResponseDto,
  CreateDonorLinkDto,
)
@Controller({ path: 'levy-exchange/donor-links', version: '1' })
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
export class DonorLinksController {
  constructor(private readonly donorLinkService: DasDonorLinkService) {}

  @Post()
  @ResponseMessage('Donor link created successfully')
  @ApiOperation({
    summary: 'Create a pending donor DAS account link',
    description:
      'Creates a donor link in pending_consent status. Complete OAuth via GET ' +
      '/levy-exchange/donor-links/{id}/consent/start before syncing levy balance.',
  })
  @ApiCreatedResponse({
    description: 'Donor link created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorLinkResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDonorLinkDto,
  ): Promise<DonorLinkResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorLinkService.create(user.organisationId!, dto);
  }

  @Get()
  @ResponseMessage('Donor links retrieved successfully')
  @ApiOperation({
    summary: 'List donor DAS account links for active organisation',
  })
  @ApiOkResponse({
    description: 'Donor links',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DonorLinkResponseDto) },
        },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DonorLinkResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorLinkService.findAll(user.organisationId!);
  }

  @Get(':id')
  @ResponseMessage('Donor link retrieved successfully')
  @ApiOperation({ summary: 'Get donor DAS account link by id' })
  @ApiOkResponse({
    description: 'Donor link detail',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorLinkResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Donor link not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DonorLinkResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorLinkService.findOne(user.organisationId!, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Donor link revoked successfully')
  @ApiOperation({
    summary: 'Revoke donor DAS account link and delete OAuth tokens',
    description:
      'Soft-deletes the donor link and removes encrypted OAuth tokens. ' +
      'Linked tranches and surplus snapshots remain for audit but the link cannot be synced again.',
  })
  @ApiNoContentResponse({ description: 'Donor link revoked' })
  @ApiBadRequestResponse({
    description: 'Donor link is already revoked',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Donor link not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.donorLinkService.remove(user.organisationId!, id);
  }

  @Post(':id/sync')
  @ResponseMessage('Donor link synced successfully')
  @ApiOperation({
    summary: 'Sync levy balance for a linked donor DAS account',
    description:
      'Refreshes the donor OAuth token when needed, fetches levy balance from DAS, ' +
      'and replaces parsed tranches used by surplus and expiry calendar endpoints.',
  })
  @ApiBadRequestResponse({
    description: 'Donor link is not linked or OAuth token refresh failed',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Synced donor link',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorLinkResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Donor link not found',
    type: ErrorResponseDto,
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DonorLinkResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorLinkService.syncDonorLink(user.organisationId!, id);
  }

  @Get(':id/consent/start')
  @ResponseMessage('Donor consent URL generated successfully')
  @ApiOperation({
    summary: 'Start donor DAS OAuth consent for a pending link',
    description:
      'Returns an ESFA DAS authorize URL. Redirect the donor browser to authorizeUrl; ' +
      'ESFA redirects back to GET /levy-exchange/donor-links/oauth/callback.',
  })
  @ApiBadRequestResponse({
    description: 'Donor link is not pending consent',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Authorization URL for ESFA DAS OAuth',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DonorLinkConsentStartResponseDto) },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Donor DAS OAuth is not configured',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Donor link not found',
    type: ErrorResponseDto,
  })
  startConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DonorLinkConsentStartResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.donorLinkService.startConsent(
      user.organisationId!,
      user.id,
      id,
    );
  }
}
