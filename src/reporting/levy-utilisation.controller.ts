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

import {
  LevyCostPerApprenticeRowDto,
  LevyUtilisationMonthlyPointDto,
  LevyUtilisationResponseDto,
  LevyUtilisationSegmentsDto,
} from './dto/levy-utilisation-response.dto.js';
import { LevyUtilisationService } from './levy-utilisation.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Reporting')
@ApiExtraModels(
  LevyUtilisationResponseDto,
  LevyUtilisationSegmentsDto,
  LevyUtilisationMonthlyPointDto,
  LevyCostPerApprenticeRowDto,
)
@Controller({ path: 'reporting/levy-utilisation', version: '1' })
@UseGuards(JwtAuthGuard, ActiveOrganisationGuard)
@ApiBearerAuth()
@ApiHeader({
  name: ORGANISATION_ID_HEADER,
  description: 'Active employer organisation UUID',
  required: false,
})
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Requires employer portal organisation',
  type: ErrorResponseDto,
})
export class LevyUtilisationController {
  constructor(private readonly utilisationService: LevyUtilisationService) {}

  @Get()
  @ResponseMessage('Levy utilisation retrieved successfully')
  @ApiOperation({
    summary: 'Employer levy utilisation chart data',
    description:
      'PRD F1.1.3 — Returns annual utilisation segments (used / expiring within 90 days / available), ' +
      'a 12-month contribution vs spend series from persisted DAS sync history, forecast slice, and cost-per-apprentice rows ' +
      'by standard and provider. Employer portal only.',
  })
  @ApiOkResponse({
    description: 'Levy utilisation dashboard payload',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(LevyUtilisationResponseDto) },
      },
    },
  })
  get(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.utilisationService.getUtilisation(user.organisationId!);
  }
}
