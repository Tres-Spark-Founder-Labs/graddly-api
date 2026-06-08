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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { BuildIlrLearnerRecordDto } from './dto/build-ilr-learner-record.dto.js';
import { IlrLearnerRecordResponseDto } from './dto/ilr-learner-record-response.dto.js';
import { IlrSubmissionResponseDto } from './dto/ilr-submission-response.dto.js';
import { IlrValidationReportResponseDto } from './dto/ilr-validation-report-response.dto.js';
import { ListIlrLearnerRecordsQueryDto } from './dto/list-ilr-learner-records-query.dto.js';
import { UpdateIlrLearnerRecordDto } from './dto/update-ilr-learner-record.dto.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrSubmissionService } from './ilr-submission.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('ILR Learner Records')
@ApiExtraModels(
  IlrLearnerRecordResponseDto,
  IlrValidationReportResponseDto,
  IlrSubmissionResponseDto,
  PaginationMetaDto,
)
@Controller({ path: 'ilr/learner-records', version: '1' })
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
export class IlrLearnerRecordsController {
  constructor(
    private readonly learnerRecordsService: IlrLearnerRecordsService,
    private readonly submissionService: IlrSubmissionService,
  ) {}

  @Post('build')
  @ResponseMessage('ILR learner record built successfully')
  @ApiOperation({
    summary: 'Build or refresh an ILR learner record from domain data',
  })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrLearnerRecordResponseDto) },
      },
    },
  })
  build(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BuildIlrLearnerRecordDto,
  ): Promise<IlrLearnerRecordResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.learnerRecordsService.build(user, dto);
  }

  @Get()
  @ResponseMessage('ILR learner records retrieved successfully')
  @ApiOperation({ summary: 'List ILR learner records' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(IlrLearnerRecordResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListIlrLearnerRecordsQueryDto,
  ): Promise<PaginatedResult<IlrLearnerRecordResponseDto>> {
    return this.learnerRecordsService.findAll(user, query);
  }

  @Get(':id')
  @ResponseMessage('ILR learner record retrieved successfully')
  @ApiOperation({ summary: 'Get an ILR learner record' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrLearnerRecordResponseDto) },
      },
    },
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrLearnerRecordResponseDto> {
    return this.learnerRecordsService.findOne(user, id);
  }

  @Patch(':id')
  @ResponseMessage('ILR learner record updated successfully')
  @ApiOperation({ summary: 'Update manual overrides and rebuild fields' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrLearnerRecordResponseDto) },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIlrLearnerRecordDto,
  ): Promise<IlrLearnerRecordResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.learnerRecordsService.update(user, id, dto);
  }

  @Post(':id/validate')
  @ResponseMessage('ILR learner record validated successfully')
  @ApiOperation({
    summary: 'Run ILR validation rules against the learner record',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrLearnerRecordResponseDto) },
      },
    },
  })
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrLearnerRecordResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.learnerRecordsService.validate(user, id);
  }

  @Get(':id/validation-report')
  @ResponseMessage('ILR validation report retrieved successfully')
  @ApiOperation({ summary: 'Get plain-English ILR validation report' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrValidationReportResponseDto) },
      },
    },
  })
  validationReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrValidationReportResponseDto> {
    return this.learnerRecordsService.getValidationReport(user, id);
  }

  @Post(':id/submit')
  @ResponseMessage('ILR record submitted successfully')
  @ApiOperation({ summary: 'Submit a validated ILR learner record to ESFA' })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrSubmissionResponseDto) },
      },
    },
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrSubmissionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.submissionService.submit(user, id);
  }

  @Post(':id/amend')
  @ResponseMessage('ILR amendment submitted successfully')
  @ApiOperation({ summary: 'Submit an ILR amendment after re-validation' })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrSubmissionResponseDto) },
      },
    },
  })
  amend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrSubmissionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.submissionService.amend(user, id);
  }

  @Get(':id/submissions')
  @ResponseMessage('ILR submissions retrieved successfully')
  @ApiOperation({ summary: 'List submission history for a learner record' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(IlrSubmissionResponseDto) },
        },
      },
    },
  })
  listSubmissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrSubmissionResponseDto[]> {
    return this.submissionService.listForRecord(user, id);
  }
}
