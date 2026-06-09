import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { CreateMatchApplicationDto } from '../dto/create-match-application.dto.js';
import { ListMatchApplicationsQueryDto } from '../dto/list-match-applications-query.dto.js';
import { MatchApplicationResponseDto } from '../dto/match-application-response.dto.js';
import { UpdateMatchApplicationDto } from '../dto/update-match-application.dto.js';
import { LevyMatchApplicationService } from '../services/levy-match-application.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Levy Exchange')
@ApiExtraModels(
  CreateMatchApplicationDto,
  UpdateMatchApplicationDto,
  MatchApplicationResponseDto,
  ListMatchApplicationsQueryDto,
  PaginationMetaDto,
)
@Controller({ path: 'levy-exchange/match-applications', version: '1' })
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
  description: 'No active organisation context or insufficient permissions',
  type: ErrorResponseDto,
})
export class MatchApplicationsController {
  constructor(
    private readonly matchApplicationService: LevyMatchApplicationService,
  ) {}

  @Post()
  @ResponseMessage('Match application created successfully')
  @ApiOperation({
    summary: 'Submit a levy transfer match application',
    description:
      'Recipient submits an application to a matched donor. Donor confirms or rejects via PATCH.',
  })
  @ApiCreatedResponse({
    description: 'Created match application',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MatchApplicationResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Duplicate pending application or donor has insufficient surplus',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMatchApplicationDto,
  ): Promise<MatchApplicationResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.matchApplicationService.create(user, dto);
  }

  @Get()
  @ResponseMessage('Match applications retrieved successfully')
  @ApiOperation({
    summary: 'List levy match applications for active organisation',
  })
  @ApiOkResponse({
    description: 'Paginated match applications',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(MatchApplicationResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMatchApplicationsQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.matchApplicationService.list(user.organisationId!, query);
  }

  @Patch(':id')
  @ResponseMessage('Match application updated successfully')
  @ApiOperation({
    summary: 'Confirm or reject a pending levy match application',
    description:
      'Donor confirms or rejects a pending application. Only pending applications ' +
      'can transition; confirmed applications unlock POST /levy-exchange/transfers.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid status transition or caller is not the donor organisation',
    type: ErrorResponseDto,
  })
  @ApiOkResponse({
    description: 'Updated match application',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MatchApplicationResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Match application not found',
    type: ErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchApplicationDto,
  ): Promise<MatchApplicationResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.matchApplicationService.updateStatus(user, id, dto);
  }
}
