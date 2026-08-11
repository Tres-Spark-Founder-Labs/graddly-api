import {
  Body,
  Controller,
  Get,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateEpaPackJobDto } from './dto/create-epa-pack-job.dto.js';
import { EpaPackJobResponseDto } from './dto/epa-pack-job-response.dto.js';
import { EpaPackJobsService } from './epa-pack-jobs.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';

@ApiTags('Portfolio')
@ApiExtraModels(EpaPackJobResponseDto, CreateEpaPackJobDto)
@Controller({ path: 'portfolio/epa-pack-jobs', version: '1' })
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
    'No active organisation context or caller cannot access the enrolment',
  type: ErrorResponseDto,
})
export class EpaPackJobsController {
  constructor(private readonly jobsService: EpaPackJobsService) {}

  @LearnerAccessible()
  @Post()
  @ResponseMessage('EPA evidence pack job queued successfully')
  @ApiOperation({
    summary: 'Queue async EPA evidence pack ZIP for an enrolment',
    description:
      'Enqueues a BullMQ job that compiles accepted portfolio evidence (by KSB kind), ' +
      'KSB heatmap summary, completed review PDFs, OTJ summary, and signed commitment PDF ' +
      'into a ZIP for EPAO submission. Poll GET /portfolio/epa-pack-jobs/:id until status is ' +
      'completed or failed. Caller must be the linked apprentice, enrolment tutor/manager, or org admin.',
  })
  @ApiCreatedResponse({
    description: 'Queued EPA pack job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EpaPackJobResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Enrolment not found or apprentice mismatch',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEpaPackJobDto,
  ): Promise<EpaPackJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.jobsService.create(user, dto);
  }

  @LearnerAccessible()
  @Get(':id')
  @ResponseMessage('EPA evidence pack job retrieved successfully')
  @ApiOperation({
    summary: 'Poll EPA evidence pack job status',
    description:
      'Returns job status, manifest (file counts per ZIP section), and errorMessage when failed. ' +
      'When status is completed, includes presigned downloadUrl and downloadExpiresAt for the ZIP.',
  })
  @ApiOkResponse({
    description: 'EPA pack job status',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EpaPackJobResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'EPA pack job not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EpaPackJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.jobsService.findOne(user, id);
  }
}
