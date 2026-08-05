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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateEvidencePackJobDto } from './dto/create-evidence-pack-job.dto.js';
import { EvidencePackJobResponseDto } from './dto/evidence-pack-job-response.dto.js';
import { EvidencePackJobsService } from './evidence-pack-jobs.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Ofsted')
@ApiExtraModels(EvidencePackJobResponseDto, CreateEvidencePackJobDto)
@Controller({ path: 'ofsted/evidence-packs', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard, CapabilityGuard)
@RequiresCapability(Capability.GENERATE_EVIDENCE_PACK)
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
    'No active organisation context or insufficient role (owner/admin required)',
  type: ErrorResponseDto,
})
export class EvidencePackJobsController {
  constructor(private readonly jobsService: EvidencePackJobsService) {}

  @Post()
  @ResponseMessage('Evidence pack job queued successfully')
  @ApiOperation({
    summary: 'Queue async Ofsted evidence pack ZIP',
    description:
      'Enqueues a BullMQ job that gathers org-scoped OTJ, review, commitment, ILR, portfolio, ' +
      'and QIP artefacts into a ZIP organised by EIF theme folders. Optional additionalStorageKeys ' +
      'are merged under custom/. Poll GET /ofsted/evidence-packs/:id until status is completed ' +
      'or failed. Requires owner or admin role.',
  })
  @ApiCreatedResponse({
    description: 'Queued evidence pack job',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EvidencePackJobResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'One or more additionalStorageKeys are not valid for the organisation',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEvidencePackJobDto,
  ): Promise<EvidencePackJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.jobsService.create(user, dto);
  }

  @Get(':id')
  @ResponseMessage('Evidence pack job retrieved successfully')
  @ApiOperation({
    summary: 'Poll evidence pack job status',
    description:
      'Returns job status, manifest (file counts per EIF theme), and errorMessage when failed. ' +
      'When status is completed, includes presigned downloadUrl and downloadExpiresAt for the ZIP.',
  })
  @ApiOkResponse({
    description: 'Evidence pack job status',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EvidencePackJobResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Evidence pack job not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidencePackJobResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.jobsService.findOne(user, id);
  }
}
