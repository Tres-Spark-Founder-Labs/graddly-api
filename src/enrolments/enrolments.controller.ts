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
  Headers,
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
import {
  ORGANISATION_ID_HEADER,
  PORTAL_TYPE_HEADER,
} from '../common/constants/organisation-headers.js';
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

import { BreakInLearningService } from './break-in-learning.service.js';
import { BreakInLearningResponseDto } from './dto/break-in-learning-response.dto.js';
import { CounterpartOrganisationLookupResponseDto } from './dto/counterpart-organisation-lookup-response.dto.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { EnrolmentJourneyResponseDto } from './dto/enrolment-journey-response.dto.js';
import { EnrolmentParticipantOptionsResponseDto } from './dto/enrolment-participant-options-response.dto.js';
import { EnrolmentResponseDto } from './dto/enrolment-response.dto.js';
import { EpaOutcomeResponseDto } from './dto/epa-outcome-response.dto.js';
import { LinkedProviderResponseDto } from './dto/linked-provider-response.dto.js';
import { LookupCounterpartOrganisationQueryDto } from './dto/lookup-counterpart-organisation-query.dto.js';
import { ParticipantUserOptionDto } from './dto/participant-user-option.dto.js';
import {
  EndBreakInLearningDto,
  RecordBreakInLearningDto,
} from './dto/record-break-in-learning.dto.js';
import { RecordEpaOutcomeDto } from './dto/record-epa-outcome.dto.js';
import { UpdateEnrolmentJourneyDto } from './dto/update-enrolment-journey.dto.js';
import { UpdateEnrolmentOrganisationLinksDto } from './dto/update-enrolment-organisation-links.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentsService } from './enrolments.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Enrolments')
@ApiExtraModels(
  // Referenced via getSchemaPath() on the break-in-learning routes but never
  // registered, so the published spec carried three dangling $refs and type
  // generation failed outright. Swagger UI renders that as an empty box, so
  // nothing noticed until the contract-drift gate consumed the spec.
  BreakInLearningResponseDto,
  LinkedProviderResponseDto,
  CounterpartOrganisationLookupResponseDto,
  EnrolmentJourneyResponseDto,
  EnrolmentParticipantOptionsResponseDto,
  EnrolmentResponseDto,
  EpaOutcomeResponseDto,
  LookupCounterpartOrganisationQueryDto,
  ParticipantUserOptionDto,
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
@ApiHeader({
  name: PORTAL_TYPE_HEADER,
  description:
    'Portal context for list scoping: provider (default) filters by organisationId; employer by employerOrganisationId; apprentice by apprenticeUserId.',
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
    private readonly breakInLearningService: BreakInLearningService,
  ) {}

  /**
   * F2.2.4 AC6 — "provider can record reason, expected return date, and
   * notify DAS".
   *
   * Pausing a learner used to be a bare status change: the profile advertised
   * a reason and an expected return date and returned `null` for both, and
   * the ESFA was never told — even though a planned break moves the expected
   * end date and the funding schedule with it.
   */
  @Post(':id/break-in-learning')
  @ResponseMessage('Break in learning recorded successfully')
  @ApiOperation({
    summary: 'Record a break in learning (pauses the learner, notifies DAS)',
  })
  @ApiCreatedResponse({
    description: 'The recorded break',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BreakInLearningResponseDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Enrolment is not active, or already on a break',
    type: ErrorResponseDto,
  })
  recordBreakInLearning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordBreakInLearningDto,
  ): Promise<BreakInLearningResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.breakInLearningService.start(user, id, dto);
  }

  @Post(':id/break-in-learning/end')
  @ResponseMessage('Return from break recorded successfully')
  @ApiOperation({
    summary: 'Record the learner returning (reactivates, notifies DAS)',
  })
  @ApiCreatedResponse({
    description: 'The closed break',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BreakInLearningResponseDto) },
      },
    },
  })
  endBreakInLearning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndBreakInLearningDto,
  ): Promise<BreakInLearningResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.breakInLearningService.end(user, id, dto);
  }

  /** Newest first: the current break, then the history behind it. */
  @Get(':id/break-in-learning')
  @ResponseMessage('Breaks in learning retrieved successfully')
  @ApiOperation({ summary: 'List breaks in learning for an enrolment' })
  @ApiOkResponse({
    description: 'Breaks, newest first',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(BreakInLearningResponseDto) },
        },
      },
    },
  })
  listBreaksInLearning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BreakInLearningResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.breakInLearningService.list(user, id);
  }

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
  @ApiOperation({
    summary: 'List enrolments scoped to the active portal',
    description:
      'Provider (default): enrolments owned by the active organisation. Employer: enrolments linked via employerOrganisationId. ' +
      'Apprentice: enrolments where apprenticeUserId matches the authenticated user. Pass X-Portal-Type to override org portalType.',
  })
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
    @Headers(PORTAL_TYPE_HEADER) rawPortalType?: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.findAll(
      user,
      query,
      parsePortalType(rawPortalType),
    );
  }

  @Get('counterpart-organisations/lookup')
  @ResponseMessage('Counterpart organisation resolved successfully')
  @ApiOperation({
    summary: 'Resolve an employer organisation by UKPRN for enrolment linking',
    description:
      'Provider-only. PRD F2.4.1 — counterpart employers are linked explicitly (UKPRN lookup or existing ' +
      'relationship via employer directory), not discovered via a global org list.',
  })
  @ApiOkResponse({
    description: 'Employer organisation matching the UKPRN',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(CounterpartOrganisationLookupResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'No employer organisation found for this UKPRN',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Active organisation is not a provider portal',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  lookupCounterpartOrganisation(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LookupCounterpartOrganisationQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.lookupCounterpartOrganisationByUkprn(
      user,
      query,
    );
  }

  /**
   * F1.2.5 AC2. Declared before the `:id` routes so the literal path wins.
   */
  @Get('linked-providers')
  @ResponseMessage('Linked providers retrieved successfully')
  @ApiOperation({
    summary: 'List training providers this employer may enrol with',
    description:
      'F1.2.5 AC2 — providers that have accepted at least one enrolment from ' +
      'this employer. Acceptance is the enrolment pipeline reaching ' +
      'provider_accepted, which is what an accepted connection request means ' +
      'in this platform. Most recently used first.',
  })
  @ApiOkResponse({
    description: 'Linked provider organisations',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(LinkedProviderResponseDto) },
        },
      },
    },
  })
  listLinkedProviders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LinkedProviderResponseDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.listLinkedProviders(user);
  }

  @Get('employer-manager-options')
  @ResponseMessage('Employer manager options retrieved successfully')
  @ApiOperation({
    summary: 'List users in the active organisation who can be a line manager',
    description:
      'F1.2.5 AC1 — the enrol form needs this before the enrolment exists, ' +
      'which the per-enrolment participant-options endpoint cannot answer.',
  })
  @ApiOkResponse({
    description: 'Selectable line managers',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ParticipantUserOptionDto) },
        },
      },
    },
  })
  listEmployerManagerOptions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ParticipantUserOptionDto[]> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.listEmployerManagerOptions(user);
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

  @Get(':id/participant-options')
  @ResponseMessage('Enrolment participant options retrieved successfully')
  @ApiOperation({
    summary: 'List selectable users for enrolment participants',
    description:
      'Provider-only. Apprentice candidates match the apprentice record email; tutors are active provider org members; ' +
      'employer managers are active members of the linked employer organisation.',
  })
  @ApiOkResponse({
    description: 'Participant selector options',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EnrolmentParticipantOptionsResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Active organisation is not a provider portal',
    type: ErrorResponseDto,
  })
  getParticipantOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentsService.getParticipantOptions(user, id);
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
