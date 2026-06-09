import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { EnrolmentResponseDto } from './dto/enrolment-response.dto.js';
import { UpdateEnrolmentOrganisationLinksDto } from './dto/update-enrolment-organisation-links.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { EnrolmentsService } from './enrolments.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Enrolments')
@ApiExtraModels(
  EnrolmentResponseDto,
  PaginationMetaDto,
  UpdateEnrolmentOrganisationLinksDto,
  UpdateEnrolmentParticipantsDto,
)
@Controller({ path: 'enrolments', version: '1' })
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
export class EnrolmentsController {
  constructor(private readonly enrolmentsService: EnrolmentsService) {}

  @Post()
  @ResponseMessage('Enrolment created successfully')
  @ApiOperation({ summary: 'Create enrolment in the active organisation' })
  @ApiCreatedResponse({
    description: 'Enrolment created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Apprentice or standard not found',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'Active or draft enrolment already exists for apprentice/standard',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEnrolmentDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.create(user, dto);
  }

  @Get()
  @ResponseMessage('Enrolments retrieved successfully')
  @ApiOperation({ summary: 'List enrolments in the active organisation' })
  @ApiOkResponse({
    description: 'Paginated enrolments',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(EnrolmentResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.findAll(user, query);
  }

  @Get(':id')
  @ResponseMessage('Enrolment retrieved successfully')
  @ApiOperation({ summary: 'Get enrolment by id' })
  @ApiOkResponse({
    description: 'Enrolment details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.findOne(user, id);
  }

  @Patch(':id/participants')
  @ResponseMessage('Enrolment participants updated successfully')
  @ApiOperation({
    summary:
      'Set apprentice, tutor, and line manager user IDs for an enrolment',
    description:
      'Assigns platform user IDs used for direct messaging threads. ' +
      'IDs may also be populated automatically when a commitment statement is fully signed.',
  })
  @ApiOkResponse({
    description: 'Updated enrolment with participant user IDs',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  updateParticipants(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnrolmentParticipantsDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.updateParticipants(user, id, dto);
  }

  @Patch(':id/organisation-links')
  @ResponseMessage('Enrolment organisation links updated successfully')
  @ApiOperation({
    summary: 'Set linked employer and provider organisation IDs',
    description:
      'Links an enrolment to counterpart organisations for cross-portal reporting ' +
      '(RPT-001 levy ROI breakdown and RPT-002 employer directory). ' +
      'See docs/reporting.md for semantics.',
  })
  @ApiOkResponse({
    description: 'Updated enrolment with organisation link IDs',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment or linked organisation not found',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  updateOrganisationLinks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnrolmentOrganisationLinksDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.updateOrganisationLinks(user, id, dto);
  }

  @Post(':id/activate')
  @ResponseMessage('Enrolment activated successfully')
  @ApiOperation({ summary: 'Activate enrolment (draft -> active)' })
  @ApiCreatedResponse({
    description: 'Enrolment activated',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid state transition',
    type: ErrorResponseDto,
  })
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.activate(user, id);
  }

  @Post(':id/complete')
  @ResponseMessage('Enrolment completed successfully')
  @ApiOperation({ summary: 'Complete enrolment (active -> completed)' })
  @ApiCreatedResponse({
    description: 'Enrolment completed',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid state transition',
    type: ErrorResponseDto,
  })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.complete(user, id);
  }

  @Post(':id/cancel')
  @ResponseMessage('Enrolment cancelled successfully')
  @ApiOperation({ summary: 'Cancel enrolment (draft|active -> cancelled)' })
  @ApiCreatedResponse({
    description: 'Enrolment cancelled',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid state transition',
    type: ErrorResponseDto,
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.cancel(user, id);
  }
}
