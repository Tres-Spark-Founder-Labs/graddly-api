import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiCreatedResponse,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { AiProgrammeEnrolmentService } from './ai-programme-enrolment.service.js';
import { AiProgrammeEnrolmentResponseDto } from './dto/ai-programme-enrolment-response.dto.js';
import { CreateAiProgrammeEnrolmentDto } from './dto/create-ai-programme-enrolment.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('AI Programmes')
@ApiExtraModels(AiProgrammeEnrolmentResponseDto, CreateAiProgrammeEnrolmentDto)
@Controller({ path: 'ai-programmes/enrolments', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active Flow (SME) organisation UUID',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Requires Flow portal organisation',
  type: ErrorResponseDto,
})
export class AiProgrammeEnrolmentController {
  constructor(private readonly enrolmentService: AiProgrammeEnrolmentService) {}

  @Post()
  @ResponseMessage('AI programme enrolment created successfully')
  @ApiOperation({
    summary: 'Enrol an apprentice on a FlowPortal AI programme',
    description:
      'PRD F4.4.2 — Creates or reuses an apprentice on the active Flow org, opens an enrolment on the programme standard ' +
      'with the seeded AI provider linked, activates the enrolment (apprentice provisioning per PRD-018), and initializes ' +
      'per-module progress rows as not_started. Flow portal only.',
  })
  @ApiCreatedResponse({
    description: 'Enrolment created, activated, and progress initialized',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AiProgrammeEnrolmentResponseDto) },
      },
    },
  })
  @ApiConflictResponse({
    description: 'Duplicate active/draft enrolment for apprentice and standard',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAiProgrammeEnrolmentDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.enrolmentService.createEnrolment(user, dto);
  }
}
