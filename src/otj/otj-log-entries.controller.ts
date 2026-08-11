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
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { BulkOtjActionResponseDto } from './dto/bulk-otj-action-response.dto.js';
import {
  BulkOtjApproveDto,
  BulkOtjRejectDto,
} from './dto/bulk-otj-action.dto.js';
import { CreateOtjLogEntryDto } from './dto/create-otj-log-entry.dto.js';
import { FlagOtjLogEntryDto } from './dto/flag-otj-log-entry.dto.js';
import { ListOtjLogEntriesQueryDto } from './dto/list-otj-log-entries-query.dto.js';
import { OtjActivityCategoryDefinitionDto } from './dto/otj-activity-category-response.dto.js';
import { OtjLogEntryResponseDto } from './dto/otj-log-entry-response.dto.js';
import { UpdateOtjLogEntryDto } from './dto/update-otj-log-entry.dto.js';
import { loadOtjActivityCategoriesConfig } from './otj-activity-categories.config.js';
import { OtjLogEntriesService } from './otj-log-entries.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('OTJ Log Entries')
@ApiExtraModels(
  OtjLogEntryResponseDto,
  OtjActivityCategoryDefinitionDto,
  PaginationMetaDto,
  BulkOtjActionResponseDto,
  CreateOtjLogEntryDto,
  UpdateOtjLogEntryDto,
)
@Controller({ path: 'otj-log-entries', version: '1' })
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
export class OtjLogEntriesController {
  constructor(private readonly service: OtjLogEntriesService) {}

  @LearnerAccessible()
  @Get('categories')
  @ResponseMessage('OTJ activity categories retrieved successfully')
  @ApiOperation({
    summary: 'List OTJ activity category definitions',
    description:
      'Returns the versioned catalogue of OTJ activity types (slug + display label) for the ' +
      'apprentice log form dropdown. These values are **not** programmes or courses — use ' +
      'enrolmentId on create to identify which course the session counts toward.',
  })
  @ApiOkResponse({
    description: 'Six PRD activity categories for the OTJ log form',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(OtjActivityCategoryDefinitionDto) },
        },
      },
    },
  })
  listCategories(): OtjActivityCategoryDefinitionDto[] {
    return loadOtjActivityCategoriesConfig().categories.map((c) => ({
      slug: c.slug,
      label: c.label,
    }));
  }

  @LearnerAccessible()
  @Post()
  @ResponseMessage('OTJ log entry created successfully')
  @ApiOperation({
    summary: 'Create an OTJ log entry',
    description:
      'Creates a draft OTJ log entry in the active organisation. enrolmentId identifies the ' +
      'programme/course; category identifies the activity type (see GET /otj-log-entries/categories). ' +
      'activityName is the session label (max 80 chars). apprenticeId must match the enrolment. ' +
      'When evidence.files is provided, each key must be org-scoped evidence storage for that apprentice.',
  })
  @ApiCreatedResponse({
    description: 'OTJ log entry created in draft status',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed (missing activityName, category, etc.)',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Enrolment not found, apprentice mismatch, or invalid evidence storage keys',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.create(user, dto);
  }

  @LearnerAccessible()
  @Get()
  @ResponseMessage('OTJ log entries retrieved successfully')
  @ApiOperation({
    summary: 'List OTJ log entries',
    description:
      'Paginated list scoped to the active organisation. Filter by status, apprentice, enrolment ' +
      '(programme/course), category (activity type), or loggedDate range.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOtjLogEntriesQueryDto,
  ): Promise<PaginatedResult<OtjLogEntryResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findAll(user, query);
  }

  @Post('bulk-approve')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.BULK_APPROVE_OTJ)
  @ResponseMessage('Bulk OTJ approval completed')
  @ApiOperation({
    summary: 'Bulk approve OTJ submitted entries (owner or admin)',
    description:
      'Transitions each entry from submitted to approved. Maximum 20 ids per call. Entries not in ' +
      'submitted status return per-id failure in the results array. Invalidates EIF score cache ' +
      'when any succeed.',
  })
  @ApiCreatedResponse({
    description: 'Bulk approval result with per-id outcomes',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BulkOtjActionResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions',
    type: ErrorResponseDto,
  })
  bulkApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkOtjApproveDto,
  ): Promise<BulkOtjActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.bulkApprove(user, dto.ids);
  }

  @Post('bulk-reject')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.BULK_APPROVE_OTJ)
  @ResponseMessage('Bulk OTJ rejection completed')
  @ApiOperation({
    summary: 'Bulk reject OTJ submitted entries (owner or admin)',
    description:
      'Transitions each entry from submitted to rejected. A reason of at least 10 characters is ' +
      'mandatory and is shown to the apprentice. Maximum 20 ids per call. Invalidates EIF score ' +
      'cache when any succeed.',
  })
  @ApiCreatedResponse({
    description: 'Bulk rejection result with per-id outcomes',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(BulkOtjActionResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions',
    type: ErrorResponseDto,
  })
  bulkReject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkOtjRejectDto,
  ): Promise<BulkOtjActionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.bulkReject(user, dto.ids, dto.reason);
  }

  @LearnerAccessible()
  @Get(':id')
  @ResponseMessage('OTJ log entry retrieved successfully')
  @ApiOperation({ summary: 'Get an OTJ log entry by id' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'OTJ log entry not found in organisation',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OtjLogEntryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.findOne(user, id);
  }

  /**
   * F2.2.4 AC3 — "tutor can flag entries".
   *
   * Not an approval decision. Approving and rejecting are the employer's call
   * about whether hours count; this is a tutor saying the entry needs a
   * conversation — implausible hours, an activity that is not off-the-job, a
   * session logged for a day the learner was absent — without removing them.
   *
   * An approved entry can be flagged. The hours stand and the question
   * remains; silently un-approving them behind the employer would be worse
   * than the concern being raised.
   */
  @Post(':id/flag')
  @ResponseMessage('OTJ log entry flagged successfully')
  @ApiOperation({ summary: 'Flag an OTJ entry for discussion (tutor)' })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'OTJ log entry not found in organisation',
    type: ErrorResponseDto,
  })
  flag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlagOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.flag(user, id, dto);
  }

  @Post(':id/unflag')
  @ResponseMessage('OTJ log entry flag cleared successfully')
  @ApiOperation({ summary: 'Clear a flag once the conversation has happened' })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
      },
    },
  })
  unflag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OtjLogEntryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.unflag(user, id);
  }

  @LearnerAccessible()
  @Patch(':id')
  @ResponseMessage('OTJ log entry updated successfully')
  @ApiOperation({
    summary: 'Update an OTJ log entry',
    description:
      'Partial update. Set status to submitted to move from draft. Enrolment/apprentice changes ' +
      're-validate the match. Evidence keys must remain org-scoped evidence paths for the apprentice.',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OtjLogEntryResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'OTJ log entry not found in organisation',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid status transition, enrolment mismatch, or bad evidence keys',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.update(user, id, dto);
  }

  @LearnerAccessible()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('OTJ log entry deleted successfully')
  @ApiOperation({ summary: 'Soft-delete an OTJ log entry' })
  @ApiNoContentResponse({ description: 'OTJ log entry deleted' })
  @ApiNotFoundResponse({
    description: 'OTJ log entry not found in organisation',
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
