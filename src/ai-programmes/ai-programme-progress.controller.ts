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
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { AiProgrammeProgressService } from './ai-programme-progress.service.js';
import {
  AiProgrammeCompletionResponseDto,
  AiProgrammeProgressModuleDto,
  AiProgrammeProgressSummaryDto,
  UpdateAiProgrammeProgressDto,
} from './dto/ai-programme-enrolment-response.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('AI Programmes')
@ApiExtraModels(
  AiProgrammeProgressSummaryDto,
  AiProgrammeProgressModuleDto,
  UpdateAiProgrammeProgressDto,
  AiProgrammeCompletionResponseDto,
)
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
export class AiProgrammeProgressController {
  constructor(private readonly progressService: AiProgrammeProgressService) {}

  @Get(':enrolmentId/progress')
  @ResponseMessage('AI programme progress retrieved successfully')
  @ApiOperation({
    summary: 'Get per-module progress for an AI track enrolment',
    description:
      'PRD F4.4.3 — Module statuses, percent complete, and enrolment summary for a FlowPortal AI enrolment owned by the active org. ' +
      'Flow portal only.',
  })
  @ApiOkResponse({
    description: 'Module progress summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AiProgrammeProgressSummaryDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Enrolment not found or not an AI track',
    type: ErrorResponseDto,
  })
  getProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.progressService.getProgress(user, enrolmentId);
  }

  @Post(':enrolmentId/progress')
  @ResponseMessage('AI programme module progress updated successfully')
  @ApiOperation({
    summary: 'Record module progress for an AI track enrolment',
    description:
      'PRD F4.4.3 — Upserts progress for a catalogue module slug (not_started, in_progress, completed) with optional metadata. ' +
      'Flow portal only.',
  })
  @ApiOkResponse({
    description: 'Updated progress summary',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AiProgrammeProgressSummaryDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid status or enrolment already completed',
    type: ErrorResponseDto,
  })
  upsertProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Body() dto: UpdateAiProgrammeProgressDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.progressService.upsertProgress(user, enrolmentId, dto);
  }

  @Post(':enrolmentId/complete')
  @ResponseMessage('AI programme completed successfully')
  @ApiOperation({
    summary: 'Complete a FlowPortal AI programme enrolment',
    description:
      'PRD F4.4.3 — Requires all modules completed; marks enrolment completed, writes completion record, idempotent if already done. ' +
      'Flow portal only.',
  })
  @ApiOkResponse({
    description: 'Completion record',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(AiProgrammeCompletionResponseDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Not all modules completed',
    type: ErrorResponseDto,
  })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.progressService.completeEnrolment(user, enrolmentId);
  }
}
