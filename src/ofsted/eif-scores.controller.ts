import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
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

import { EifCriterionDefinitionDto } from './dto/eif-criterion-response.dto.js';
import { EifScoresPayloadDto } from './dto/eif-scores-response.dto.js';
import { loadEifCriteriaConfig } from './eif-criteria.config.js';
import { EifScoreService } from './eif-score.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Ofsted')
@ApiExtraModels(EifScoresPayloadDto, EifCriterionDefinitionDto)
@Controller({ path: 'ofsted', version: '1' })
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
export class EifScoresController {
  constructor(private readonly eifScoreService: EifScoreService) {}

  @Get('eif-criteria')
  @ResponseMessage('EIF criteria retrieved successfully')
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(EifCriterionDefinitionDto) },
        },
      },
    },
  })
  listCriteria(): EifCriterionDefinitionDto[] {
    return loadEifCriteriaConfig().criteria.map((c) => ({
      slug: c.slug,
      label: c.label,
    }));
  }

  @Get('eif-scores')
  @ResponseMessage('EIF readiness scores retrieved successfully')
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EifScoresPayloadDto) },
      },
    },
  })
  getScores(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EifScoresPayloadDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.eifScoreService.getScores(user);
  }
}
