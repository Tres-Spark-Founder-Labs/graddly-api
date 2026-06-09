import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { PORTAL_TYPE_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { parsePortalType } from '../common/utils/parse-portal-type.util.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { AcceptInvitationResultDto } from './dto/accept-invitation-result.dto.js';
import { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';
import { InvitationInvitedByDto } from './dto/invitation-invited-by.dto.js';
import { InvitationResponseDto } from './dto/invitation-response.dto.js';
import { InvitationsService } from './invitations.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Invitations')
@ApiExtraModels(
  InvitationResponseDto,
  InvitationInvitedByDto,
  PaginationMetaDto,
  AcceptInvitationResultDto,
)
@Controller('invitations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @ResponseMessage('Invitation accepted successfully')
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Uses an opaque token from the invitation email. Runs under RLS bootstrap so the invitee can complete membership before org-scoped policies apply. Requires a verified email on the authenticated user that matches the invitation.',
  })
  @ApiOkResponse({
    description: 'Membership created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AcceptInvitationResultDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Email not verified, wrong invitee email, or expired invite',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Already a member of the organisation',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResultDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.invitationsService.accept(user, dto);
  }

  @Get()
  @UseGuards(ActiveOrganisationGuard)
  @ResponseMessage('Invitations retrieved successfully')
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Optional. Overrides the JWT default active organisation when you are a member.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiOperation({ summary: 'List invitations for the active organisation' })
  @ApiOkResponse({
    description: 'Paginated invitations',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(InvitationResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'No active organisation context',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.invitationsService.list(user, query);
  }

  @Post()
  @UseGuards(ActiveOrganisationGuard, RolesGuard)
  @Roles(OrganisationRole.OWNER, OrganisationRole.ADMIN)
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Optional. Overrides the JWT default active organisation when you are a member.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiHeader({
    name: 'X-Portal-Type',
    description:
      'Portal the invitee should land on. Determines which frontend URL is embedded in the invitation email. Use "apprentice" to send the apprentice portal link.',
    required: false,
    schema: { type: 'string', enum: Object.values(PortalType) },
  })
  @ResponseMessage('Invitation created successfully')
  @ApiOperation({ summary: 'Create an invitation (owner or admin)' })
  @ApiCreatedResponse({
    description: 'Invitation created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(InvitationResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or no active organisation',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Duplicate invite or user already a member',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.invitationsService.create(
      user,
      dto,
      parsePortalType(rawPortalType),
    );
  }

  @Post(':id/resend')
  @UseGuards(ActiveOrganisationGuard, RolesGuard)
  @Roles(OrganisationRole.OWNER, OrganisationRole.ADMIN)
  @Throttle({ default: { limit: 0 }, auth: { ttl: 60_000, limit: 5 } })
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Optional. Overrides the JWT default active organisation when you are a member.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @ApiHeader({
    name: 'X-Portal-Type',
    description:
      'Portal the invitee should land on. Determines which frontend URL is embedded in the invitation email. Use "apprentice" to send the apprentice portal link.',
    required: false,
    schema: { type: 'string', enum: Object.values(PortalType) },
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invitation resent successfully')
  @ApiOperation({ summary: 'Resend invitation email (owner or admin)' })
  @ApiOkResponse({
    description: 'Invitation refreshed',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(InvitationResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Invitation not found',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or no active organisation',
    type: ErrorResponseDto,
  })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.invitationsService.resend(
      user,
      id,
      parsePortalType(rawPortalType),
    );
  }

  @Delete(':id')
  @UseGuards(ActiveOrganisationGuard, RolesGuard)
  @Roles(OrganisationRole.OWNER, OrganisationRole.ADMIN)
  @ApiHeader({
    name: 'X-Organisation-Id',
    description:
      'Optional. Overrides the JWT default active organisation when you are a member.',
    required: false,
    schema: { format: 'uuid', type: 'string' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Invitation revoked successfully')
  @ApiOperation({ summary: 'Revoke an invitation (owner or admin)' })
  @ApiNoContentResponse({ description: 'Invitation revoked' })
  @ApiNotFoundResponse({
    description: 'Invitation not found',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or no active organisation',
    type: ErrorResponseDto,
  })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.invitationsService.revoke(user, id);
  }
}
