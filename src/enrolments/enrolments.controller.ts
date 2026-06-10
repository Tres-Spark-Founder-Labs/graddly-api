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
import { EnrolmentJourneyResponseDto } from './dto/enrolment-journey-response.dto.js';
import { EnrolmentResponseDto } from './dto/enrolment-response.dto.js';
import { EpaOutcomeResponseDto } from './dto/epa-outcome-response.dto.js';
import { RecordEpaOutcomeDto } from './dto/record-epa-outcome.dto.js';
import { UpdateEnrolmentJourneyDto } from './dto/update-enrolment-journey.dto.js';
import { UpdateEnrolmentOrganisationLinksDto } from './dto/update-enrolment-organisation-links.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentsService } from './enrolments.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Enrolments')
@ApiExtraModels(
  EnrolmentJourneyResponseDto,
  EnrolmentResponseDto,
  EpaOutcomeResponseDto,
  PaginationMetaDto,
  RecordEpaOutcomeDto,
  UpdateEnrolmentJourneyDto,
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
  constructor(
    private readonly enrolmentsService: EnrolmentsService,
    private readonly enrolmentJourneyService: EnrolmentJourneyService,
  ) {}

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

  @Get(':id/journey')
  @ResponseMessage('Enrolment journey retrieved successfully')
  @ApiOperation({
    summary: 'Programme timeline, gateway checklist, and OTJ pace snapshot',
    description:
      'Returns chronological milestones, gateway readiness checklist with completion %, EPA countdown, and current OTJ pace vs EPA target. Notifies provider admins once when gateway reaches 100%.',
  })
  @ApiOkResponse({
    description: 'Enrolment journey',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentJourneyResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  getJourney(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentJourneyService.getJourney(user, id);
  }

  @Patch(':id/journey')
  @ResponseMessage('Enrolment journey updated successfully')
  @ApiOperation({
    summary: 'Update journey settings (e.g. EPA date)',
    description:
      'Provider/tutor sets the confirmed EPA date used for countdown and pace calculations.',
  })
  @ApiOkResponse({
    description: 'Updated enrolment journey',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentJourneyResponseDto) },
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
  updateJourney(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnrolmentJourneyDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentJourneyService.updateJourney(user, id, dto);
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
  @ApiOperation({
    summary: 'Activate enrolment (draft -> active)',
    description:
      'Sets enrolment status to active, sends an apprentice portal invitation (or links an existing user), advances pipeline to `invited` or `account_created`, and notifies provider admins that acceptance is pending.',
  })
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

  @Post(':id/accept-provider')
  @ResponseMessage('Enrolment accepted by provider successfully')
  @ApiOperation({
    summary: 'Provider accepts an active enrolment',
    description:
      'Advances pipeline to `provider_accepted`. Caller must be the linked provider organisation (or the enrolment-owning org when no provider link is set). Requires pipeline at least `account_created`.',
  })
  @ApiCreatedResponse({
    description: 'Enrolment accepted by provider',
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
  @ApiForbiddenResponse({
    description: 'Caller is not the linked provider organisation',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid state or pipeline prerequisite not met',
    type: ErrorResponseDto,
  })
  acceptProvider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.acceptProvider(user, id);
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

  @Post(':id/epa-outcome')
  @ResponseMessage('EPA outcome recorded successfully')
  @ApiOperation({
    summary: 'Record EPA outcome for a completed enrolment',
    description:
      'Persists the EPA assessment result and queues a DAS completion notification push with the outcome. Enrolment must already be completed.',
  })
  @ApiCreatedResponse({
    description: 'EPA outcome recorded',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EpaOutcomeResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Enrolment not completed',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'EPA outcome already recorded',
    type: ErrorResponseDto,
  })
  recordEpaOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordEpaOutcomeDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.recordEpaOutcome(user, id, dto);
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
