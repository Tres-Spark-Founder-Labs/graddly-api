import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
  @ApiOperation({
    summary: 'List published EIF criterion definitions',
    description:
      'Returns the versioned criteria catalogue (slug + display label) used by EIF scores ' +
      'and QIP actions. Slugs are stable identifiers; scoring weights are configured server-side.',
  })
  @ApiOkResponse({
    description:
      'Seven EIF criteria for the active provider organisation context',
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
  @ApiOperation({
    summary: 'Get org-level EIF readiness scores',
    description:
      'Aggregates live domain signals into seven criterion percentages (0–100), overall %, RAG ' +
      '(red < 60, amber 60–79, green ≥ 80), and alertBanner when any criterion is below 75%. ' +
      'Results are cached in Redis for up to EIF_SCORE_CACHE_TTL_SECONDS (default 1 hour); ' +
      'the cached flag indicates a cache hit. Cache is invalidated when underlying OTJ, review, ' +
      'commitment, ILR, or portfolio data changes.',
  })
  @ApiOkResponse({
    description: 'EIF readiness envelope for the active organisation',
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
