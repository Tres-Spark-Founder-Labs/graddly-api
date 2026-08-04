import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateEmployerVisitDto } from './dto/create-employer-visit.dto.js';
import {
  EmployerVisitResponseDto,
  NextVisitSuggestionResponseDto,
} from './dto/employer-visit-response.dto.js';
import { ListEmployerVisitsQueryDto } from './dto/list-employer-visits-query.dto.js';
import { toEmployerVisitResponse } from './employer-visit.mapper.js';
import {
  EMPLOYER_VISIT_INTERVAL_WEEKS,
  EmployerVisitsService,
} from './employer-visits.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.4.2 — the employer visit log, for Ofsted evidence.
 */
@ApiTags('Employer Visits')
@ApiExtraModels(EmployerVisitResponseDto, NextVisitSuggestionResponseDto)
@Controller({ path: 'employer-visits', version: '1' })
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
  description: 'No active organisation context, or not a provider portal',
  type: ErrorResponseDto,
})
export class EmployerVisitsController {
  constructor(private readonly service: EmployerVisitsService) {}

  @Post()
  @ResponseMessage('Employer visit recorded successfully')
  @ApiOperation({ summary: 'Record an employer visit' })
  @ApiCreatedResponse({
    description: 'The recorded visit',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EmployerVisitResponseDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'A named learner is not enrolled with this employer',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployerVisitDto,
  ): Promise<EmployerVisitResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const created = await this.service.create(user, dto);
    /**
     * Re-read rather than returning the saved entity.
     *
     * `save()` gives back what was written, which has no `employerOrganisation`
     * relation loaded — so the created response carried `employerName: null`
     * while the list and detail routes carried the name. Three routes must
     * describe a visit identically or callers learn to distrust one of them.
     */
    const { visit, learners } = await this.service.findOne(user, created.id);
    return toEmployerVisitResponse(visit, learners);
  }

  /**
   * F2.4.2 AC4. Placed before `:id` so "next-visit-suggestion" is not parsed
   * as a UUID route parameter.
   */
  @Get('next-visit-suggestion')
  @ResponseMessage('Next visit suggestion retrieved successfully')
  @ApiOperation({ summary: 'Suggested next visit date for an employer' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(NextVisitSuggestionResponseDto) },
      },
    },
  })
  async suggestNextVisit(
    @CurrentUser() user: AuthenticatedUser,
    @Query('employerOrganisationId', ParseUUIDPipe)
    employerOrganisationId: string,
  ): Promise<NextVisitSuggestionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.service.suggestNextVisitDate(
      user,
      employerOrganisationId,
    );
    return { ...result, intervalWeeks: EMPLOYER_VISIT_INTERVAL_WEEKS };
  }

  @Get()
  @ResponseMessage('Employer visits retrieved successfully')
  @ApiOperation({ summary: 'List employer visits, newest first' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(EmployerVisitResponseDto) },
        },
      },
    },
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEmployerVisitsQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const result = await this.service.list(user, query);
    return new PaginatedResult(
      result.items.map((visit) =>
        toEmployerVisitResponse(
          visit,
          result.learnersByVisit.get(visit.id) ?? [],
        ),
      ),
      result.meta,
    );
  }

  @Get(':id')
  @ResponseMessage('Employer visit retrieved successfully')
  @ApiOperation({ summary: 'Get one employer visit' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(EmployerVisitResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Visit not found in this organisation',
    type: ErrorResponseDto,
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EmployerVisitResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const { visit, learners } = await this.service.findOne(user, id);
    return toEmployerVisitResponse(visit, learners);
  }
}
