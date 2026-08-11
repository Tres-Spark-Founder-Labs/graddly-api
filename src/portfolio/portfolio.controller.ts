import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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

import { KsbCoverageResponseDto } from './dto/ksb-coverage-response.dto.js';
import { KsbHeatmapResponseDto } from './dto/ksb-heatmap-response.dto.js';
import { UpsertKsbCoverageDto } from './dto/upsert-ksb-coverage.dto.js';
import { PortfolioHeatmapService } from './portfolio-heatmap.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';

@ApiTags('Portfolio')
@ApiExtraModels(KsbHeatmapResponseDto, KsbCoverageResponseDto)
@Controller({ path: 'portfolio', version: '1' })
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
export class PortfolioController {
  constructor(private readonly heatmapService: PortfolioHeatmapService) {}

  @LearnerAccessible()
  @Get('ksb-heatmap')
  @ResponseMessage('KSB heatmap retrieved successfully')
  @ApiOperation({ summary: 'Get KSB coverage heatmap for an enrolment' })
  @ApiOkResponse({
    description: 'KSB coverage heatmap',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(KsbHeatmapResponseDto) },
      },
    },
  })
  getHeatmap(
    @CurrentUser() user: AuthenticatedUser,
    @Query('enrolmentId', ParseUUIDPipe) enrolmentId: string,
  ): Promise<KsbHeatmapResponseDto> {
    return this.heatmapService.getHeatmap(user, enrolmentId);
  }

  @Put('enrolments/:enrolmentId/ksb-coverage/:ksbDefinitionId')
  @ResponseMessage('KSB coverage assessment saved successfully')
  @ApiOperation({ summary: 'Set tutor coverage assessment for a KSB cell' })
  @ApiOkResponse({
    description: 'KSB coverage assessment saved',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(KsbCoverageResponseDto) },
      },
    },
  })
  upsertCoverage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Param('ksbDefinitionId', ParseUUIDPipe) ksbDefinitionId: string,
    @Body() dto: UpsertKsbCoverageDto,
  ): Promise<KsbCoverageResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.heatmapService.upsertCoverage(
      user,
      enrolmentId,
      ksbDefinitionId,
      dto,
    );
  }
}
