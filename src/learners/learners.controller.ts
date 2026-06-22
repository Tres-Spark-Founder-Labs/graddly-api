import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateInterventionActionDto } from './dto/create-intervention-action.dto.js';
import { LearnerDocumentItemDto } from './dto/learner-document-item.dto.js';
import {
  LearnerDocumentsEnrolmentGroupDto,
  LearnerDocumentsResponseDto,
} from './dto/learner-documents-response.dto.js';
import { LearnerProfileResponseDto } from './dto/learner-profile-response.dto.js';
import {
  InterventionActionResponseDto,
  InterventionQueueEntryResponseDto,
  InterventionQueueResponseDto,
  LearnerCohortEntryResponseDto,
} from './dto/learner-provider-response.dto.js';
import {
  ListInterventionQueueQueryDto,
  ListLearnerCohortQueryDto,
} from './dto/list-learner-cohort-query.dto.js';
import { ListLearnerDocumentsQueryDto } from './dto/list-learner-documents-query.dto.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { InterventionQueueService } from './intervention-queue.service.js';
import {
  LearnerCohortCsvResult,
  LearnerCohortService,
} from './learner-cohort.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerProfileService } from './learner-profile.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Response } from 'express';

function isCsvCohortResult(
  result:
    | PaginatedResult<LearnerCohortEntryResponseDto>
    | LearnerCohortCsvResult,
): result is LearnerCohortCsvResult {
  return 'csv' in result;
}

@ApiTags('Learners')
@ApiExtraModels(
  LearnerDocumentsResponseDto,
  LearnerDocumentsEnrolmentGroupDto,
  LearnerDocumentItemDto,
  ListLearnerDocumentsQueryDto,
  LearnerCohortEntryResponseDto,
  PaginationMetaDto,
  ListLearnerCohortQueryDto,
  InterventionQueueResponseDto,
  InterventionQueueEntryResponseDto,
  InterventionActionResponseDto,
  CreateInterventionActionDto,
  LearnerProfileResponseDto,
  ListInterventionQueueQueryDto,
)
@Controller({ path: 'learners', version: '1' })
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
  description:
    'No active organisation context, non-provider org, or enrolment not accessible',
  type: ErrorResponseDto,
})
export class LearnersController {
  constructor(
    private readonly documentsService: LearnerDocumentsService,
    private readonly cohortService: LearnerCohortService,
    private readonly interventionQueueService: InterventionQueueService,
    private readonly interventionActionsService: InterventionActionsService,
    private readonly profileService: LearnerProfileService,
  ) {}

  @Get('me/documents')
  @ResponseMessage('Learner documents retrieved successfully')
  @ApiOperation({
    summary: 'List my signed documents and accepted evidence',
    description:
      'Returns a unified document library for the authenticated apprentice user: ' +
      'signed commitment PDFs, completed review PDFs, and accepted portfolio evidence ' +
      '(metadata plus presigned download URLs for stored files). External link evidence ' +
      'includes externalUrl only. Optionally filter with ?enrolmentId= when the user has ' +
      'multiple active enrolments. Presigned URLs expire per S3_PRESIGN_DOWNLOAD_TTL_SECONDS.',
  })
  @ApiOkResponse({
    description: 'Document library grouped by enrolment',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LearnerDocumentsResponseDto) },
      },
    },
  })
  listMyDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLearnerDocumentsQueryDto,
  ): Promise<LearnerDocumentsResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.documentsService.listMyDocuments(user, query);
  }

  @Get('cohort')
  @ResponseMessage('Learner cohort retrieved successfully')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Provider cohort dashboard',
    description:
      'Paginated unified learner table for the active provider organisation. Columns: learner name, ' +
      'employer, standard, start date, OTJ %, next review, EPA date, status badge, tutor. ' +
      'Filter by employer, standard, status badge, tutor, or EPA month (YYYY-MM). ' +
      'Use format=csv for a full CSV attachment (pagination meta still applies to row count).',
  })
  @ApiOkResponse({
    description: 'Cohort rows (JSON) or CSV attachment',
    schema: {
      oneOf: [
        {
          properties: {
            message: { type: 'string' },
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(LearnerCohortEntryResponseDto) },
            },
            meta: { $ref: getSchemaPath(PaginationMetaDto) },
          },
        },
        { type: 'string', description: 'CSV body when format=csv' },
      ],
    },
  })
  async listCohort(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLearnerCohortQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.cohortService.list(user, query);

    if (isCsvCohortResult(result)) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="learner-cohort-${user.organisationId}.csv"`,
      );
      return result.csv;
    }

    return result;
  }

  @Get('intervention-queue')
  @ResponseMessage('Intervention queue retrieved successfully')
  @ApiOperation({
    summary: 'At-risk intervention queue',
    description:
      'Lists active enrolments flagged for intervention (OTJ behind, missed review, gateway stalled) ' +
      'sorted by severity score then days since last activity. Includes atRiskCount for sidebar badge. ' +
      'Filter with tutorUserId or mine=true for tutor caseload.',
  })
  @ApiOkResponse({
    description: 'Sorted intervention queue',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(InterventionQueueResponseDto) },
      },
    },
  })
  listInterventionQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInterventionQueueQueryDto,
  ): Promise<InterventionQueueResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.interventionQueueService.list(user, query);
  }

  @Post(':enrolmentId/interventions')
  @ResponseMessage('Intervention action logged successfully')
  @ApiOperation({
    summary: 'Log an intervention action',
    description:
      'Records a tutor intervention against an enrolment: contact made, review scheduled, ' +
      'employer notified, or escalated. Provider organisation required.',
  })
  @ApiCreatedResponse({
    description: 'Intervention action created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(InterventionActionResponseDto) },
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
  createIntervention(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Body() dto: CreateInterventionActionDto,
  ): Promise<InterventionActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.interventionActionsService.create(user, enrolmentId, dto);
  }

  @Get(':enrolmentId/profile')
  @ResponseMessage('Learner profile retrieved successfully')
  @ApiOperation({
    summary: 'Individual learner profile aggregate',
    description:
      'Single-call provider profile: personal details, employer, programme, tutor, full review history, ' +
      'OTJ summary and recent logs, document library refs, message thread IDs, and break-in-learning snapshot.',
  })
  @ApiOkResponse({
    description: 'Learner profile',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LearnerProfileResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found',
    type: ErrorResponseDto,
  })
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
  ): Promise<LearnerProfileResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.profileService.getProfile(user, enrolmentId);
  }
}
