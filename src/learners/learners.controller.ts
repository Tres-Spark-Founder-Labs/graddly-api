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

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';

import { BulkAssignTutorDto } from './dto/bulk-assign-tutor.dto.js';
import { CreateInterventionActionDto } from './dto/create-intervention-action.dto.js';
import { LearnerDocumentItemDto } from './dto/learner-document-item.dto.js';
import {
  LearnerDocumentsEnrolmentGroupDto,
  LearnerDocumentsResponseDto,
} from './dto/learner-documents-response.dto.js';
import {
  LearnerMeSummaryOtjPaceDto,
  LearnerMeSummaryResponseDto,
} from './dto/learner-me-summary-response.dto.js';
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
import { TutorCaseloadResponseDto } from './dto/tutor-caseload-response.dto.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { InterventionQueueService } from './intervention-queue.service.js';
import {
  LearnerCohortCsvResult,
  LearnerCohortService,
} from './learner-cohort.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMeSummaryService } from './learner-me-summary.service.js';
import { LearnerProfileService } from './learner-profile.service.js';
import { TutorCaseloadService } from './tutor-caseload.service.js';

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
  LearnerMeSummaryResponseDto,
  LearnerMeSummaryOtjPaceDto,
  ListInterventionQueueQueryDto,
  TutorCaseloadResponseDto,
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
    private readonly meSummaryService: LearnerMeSummaryService,
    private readonly tutorCaseloadService: TutorCaseloadService,
  ) {}

  @LearnerAccessible()
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

  @LearnerAccessible()
  @Get('me/summary')
  @ResponseMessage('Learner summary retrieved successfully')
  @ApiOperation({
    summary: 'Apprentice dashboard summary',
    description:
      'Returns the active enrolment, OTJ pace snapshot, next scheduled review, EPA countdown, and alert level ' +
      'for the authenticated apprentice user. Requires an active provider organisation ' +
      '(apprentices are scoped to their training provider org).',
  })
  @ApiOkResponse({
    description: 'Learner dashboard summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LearnerMeSummaryResponseDto) },
      },
    },
  })
  getMySummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LearnerMeSummaryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.meSummaryService.getSummary(user);
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

  /**
   * F2.2.1 AC2 — option lists for the employer, standard and tutor filters.
   *
   * Declared before `cohort/export` and after `cohort` for readability; the
   * paths are distinct so ordering does not matter.
   */
  @Get('cohort/filter-options')
  @ResponseMessage('Cohort filter options retrieved successfully')
  @ApiOperation({
    summary: 'Employer, standard and tutor options for the cohort filters',
    description:
      'F2.2.1 AC2. Derived from the provider’s own cohort, so every option ' +
      'matches at least one learner rather than listing the whole table.',
  })
  @ApiOkResponse({ description: 'Filter options' })
  cohortFilterOptions(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.cohortService.getFilterOptions(user);
  }

  /**
   * F2.2.1 AC5 — the PDF half of "exportable as CSV and PDF".
   *
   * Queued rather than served inline, unlike the CSV: a thousand-row
   * landscape table with a repeated header is real rendering work, and this
   * is the same pipeline every other PDF on the platform uses.
   *
   * Takes the same query as the table so the document matches the screen it
   * was exported from.
   */
  @Post('cohort/export')
  @ResponseMessage('Cohort PDF export queued successfully')
  @ApiOperation({
    summary: 'Queue the learner cohort table as a PDF',
    description:
      'F2.2.1 AC5. Accepts the same filters as GET /learners/cohort and ' +
      'prints them on the document. Poll `GET /pdf/jobs/{jobId}`.',
  })
  @ApiCreatedResponse({
    description: 'Queued PDF generation job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PdfJobResponseDto) },
      },
    },
  })
  exportCohortPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLearnerCohortQueryDto,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.cohortService.exportPdf(user, query);
  }

  /**
   * F2.2.5 AC2 — the caseload dashboard.
   *
   * Open to any member: how work is distributed is not privileged
   * information, and a tutor seeing their own caseload beside their
   * colleagues' is much of the point of the screen.
   */
  @Get('caseload')
  @ResponseMessage('Tutor caseload retrieved successfully')
  @ApiOperation({
    summary: 'Learner count, at-risk count and review compliance per tutor',
  })
  @ApiOkResponse({
    description: 'Sorted worst-first; includes an Unassigned row',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(TutorCaseloadResponseDto) },
      },
    },
  })
  getCaseload(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TutorCaseloadResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.tutorCaseloadService.getCaseload(user);
  }

  /**
   * F2.2.5 AC1 — bulk tutor assignment.
   *
   * Owner/admin only: reassigning responsibility for a learner is a
   * management decision, not something a tutor does to their own workload.
   */
  @Post('caseload/assign-tutor')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_TUTOR_CASELOAD)
  @ResponseMessage('Tutor assigned successfully')
  @ApiOperation({ summary: 'Assign or clear a tutor across many enrolments' })
  @ApiCreatedResponse({
    description: 'How many enrolments were reassigned',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: { updated: { type: 'number' } },
        },
      },
    },
  })
  assignTutorInBulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignTutorDto,
  ): Promise<{ updated: number }> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.tutorCaseloadService.assignTutorInBulk(
      user,
      dto.enrolmentIds,
      dto.tutorUserId ?? null,
    );
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
