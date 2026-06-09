import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { SearchMatchesResponseDto } from '../dto/search-matches-response.dto.js';
import { SearchMatchesDto } from '../dto/search-matches.dto.js';
import { LevyMatchingService } from '../services/levy-matching.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(SearchMatchesDto, SearchMatchesResponseDto)
@Controller({ path: 'levy-exchange/matches', version: '1' })
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
export class MatchingController {
  constructor(private readonly matchingService: LevyMatchingService) {}

  @Post('search')
  @ResponseMessage('Levy matches retrieved successfully')
  @ApiOperation({
    summary: 'Search rule-based levy donor matches for the active recipient',
    description:
      'Scores eligible donors by sector, region, size band, and programme type. ' +
      'When no donors match, the recipient is added to the waiting pool (addedToWaitingPool=true).',
  })
  @ApiBadRequestResponse({
    description: 'Recipient profile incomplete or invalid search parameters',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Ranked donor matches',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(SearchMatchesResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Recipient profile not found',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SearchMatchesDto,
  ): Promise<SearchMatchesResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.matchingService.searchMatches(user.organisationId!, dto);
  }
}
