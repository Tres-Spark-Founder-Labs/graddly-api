import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';

import { CreateQipActionDto } from './dto/create-qip-action.dto.js';
import { ListQipActionsQueryDto } from './dto/list-qip-actions-query.dto.js';
import { QipActionResponseDto } from './dto/qip-action-response.dto.js';
import { QipActionsSummaryDto } from './dto/qip-actions-summary.dto.js';
import { UpdateQipActionProgressDto } from './dto/update-qip-action-progress.dto.js';
import { UpdateQipActionDto } from './dto/update-qip-action.dto.js';
import { QipActionsService } from './qip-actions.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Ofsted')
@ApiExtraModels(
  QipActionResponseDto,
  PaginationMetaDto,
  QipActionsSummaryDto,
  CreateQipActionDto,
  UpdateQipActionDto,
)
@Controller({ path: 'qip-actions', version: '1' })
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
export class QipActionsController {
  constructor(private readonly service: QipActionsService) {}

  /**
   * F2.1.2 AC5 — the plan as an inspection document.
   *
   * Guarded by `DOWNLOAD_EVIDENCE_PACK` rather than `MANAGE_QIP`: producing
   * the plan is reading it, and being unable to hand an inspector the QIP
   * because the one admin is on leave is a worse failure than a tutor
   * printing it.
   */
  @Post('export')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.DOWNLOAD_EVIDENCE_PACK)
  @ResponseMessage('QIP export queued successfully')
  @ApiOperation({
    summary: 'Queue the Quality Improvement Plan as a PDF',
    description:
      'F2.1.2 AC5 — grouped by EIF criterion, with owner names, target ' +
      'dates, status and overdue count. Poll `GET /pdf/jobs/{jobId}`.',
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
  exportPdf(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PdfJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.exportPdf(user);
  }

  @Post()
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_QIP)
  @ResponseMessage('QIP action created successfully')
  @ApiOperation({
    summary: 'Create a QIP action',
    description:
      'Creates a Quality Improvement Plan action in the active organisation. ' +
      'assignedOwnerUserId must reference an active org member. eifCriterionSlug must ' +
      'match a slug from GET /ofsted/eif-criteria. evidenceAttachmentKeys, when provided, ' +
      'must be org-scoped storage keys.',
  })
  @ApiCreatedResponse({
    description: 'QIP action created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(QipActionResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid EIF criterion slug, owner not in organisation, or invalid storage key',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQipActionDto,
  ): Promise<QipActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.create(user, dto);
  }

  @Get()
  @ResponseMessage('QIP actions retrieved successfully')
  @ApiOperation({
    summary: 'List QIP actions',
    description:
      'Paginated list for the active organisation. Overdue items (target date in the past ' +
      'and status not completed) sort first. Use overdue=true to filter to overdue actions only.',
  })
  @ApiOkResponse({
    description: 'Paginated QIP actions',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(QipActionResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListQipActionsQueryDto,
  ): Promise<PaginatedResult<QipActionResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findAll(user, query);
  }

  @Get('summary')
  @ResponseMessage('QIP actions summary retrieved successfully')
  @ApiOperation({
    summary: 'QIP hub progress summary',
    description:
      'Returns total, completed, and overdue action counts plus percentComplete for the ' +
      'provider Ofsted hub progress widget.',
  })
  @ApiOkResponse({
    description: 'QIP summary counts',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(QipActionsSummaryDto) },
      },
    },
  })
  summary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QipActionsSummaryDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.getSummary(user);
  }

  @Get(':id')
  @ResponseMessage('QIP action retrieved successfully')
  @ApiOperation({ summary: 'Get a QIP action by id' })
  @ApiOkResponse({
    description: 'QIP action including derived isOverdue flag',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(QipActionResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'QIP action not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QipActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findOne(user, id);
  }

  /**
   * Guarded as planning rather than completion, because this one endpoint
   * does both: it accepts `status` alongside title, owner, target date and
   * linked criterion. `Capability.COMPLETE_QIP_ACTION` exists for the wider
   * rule but is not wired here — letting a tutor mark their own action done
   * is reasonable, letting them rewrite the plan is not, and the endpoint
   * cannot currently tell the two apart. F2.1.2 splits them.
   */
  /**
   * F2.1.2 — the narrow half of updating an action.
   *
   * The groundwork restricted every QIP write to `MANAGE_QIP` because the
   * single `PATCH` endpoint could not tell "I finished my action, here is the
   * evidence" from "I rewrote the plan". This separates them: status, notes
   * and attachments only, open to anyone who can record learner work.
   *
   * Without it AC6 would be unreachable for the people it is about — the
   * tutor who did the work is the one holding the evidence, and making them
   * ask an admin to upload it is how evidence stops being attached at all.
   */
  @Patch(':id/progress')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.COMPLETE_QIP_ACTION)
  @ResponseMessage('QIP action progress updated successfully')
  @ApiOperation({
    summary: 'Record progress on a QIP action',
    description:
      'F2.1.2 — status, evidence notes and supporting documents only. The ' +
      "plan's content (title, owner, target date, linked criterion) cannot " +
      'be changed here; use PATCH /qip-actions/{id} for that.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(QipActionResponseDto) },
      },
    },
  })
  updateProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQipActionProgressDto,
  ): Promise<QipActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.updateProgress(user, id, dto);
  }

  @Patch(':id')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_QIP)
  @ResponseMessage('QIP action updated successfully')
  @ApiOperation({
    summary: 'Update a QIP action',
    description:
      'Partial update. Same validation rules as create apply to eifCriterionSlug, ' +
      'assignedOwnerUserId, and evidenceAttachmentKeys when those fields are sent.',
  })
  @ApiOkResponse({
    description: 'Updated QIP action',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(QipActionResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid EIF criterion slug, owner not in organisation, or invalid storage key',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'QIP action not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQipActionDto,
  ): Promise<QipActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_QIP)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('QIP action deleted successfully')
  @ApiOperation({ summary: 'Soft-delete a QIP action' })
  @ApiNoContentResponse({ description: 'QIP action deleted' })
  @ApiNotFoundResponse({
    description: 'QIP action not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.remove(user, id);
  }
}
