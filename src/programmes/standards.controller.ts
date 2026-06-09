import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateStandardDto } from './dto/create-standard.dto.js';
import { StandardResponseDto } from './dto/standard-response.dto.js';
import { UpdateStandardDto } from './dto/update-standard.dto.js';
import { Standard } from './entities/standard.entity.js';
import { StandardsService } from './standards.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Standards')
@ApiExtraModels(StandardResponseDto, PaginationMetaDto)
@Controller({ path: 'standards', version: '1' })
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
export class StandardsController {
  constructor(private readonly standardsService: StandardsService) {}

  @Post()
  @ResponseMessage('Standard created successfully')
  @ApiOperation({ summary: 'Create a standard in the active organisation' })
  @ApiCreatedResponse({
    description: 'Standard created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(StandardResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Standard code already exists',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Programme not found',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStandardDto,
  ): Promise<StandardResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.standardsService
      .create(user, dto)
      .then((standard) => this.toResponseDto(standard));
  }

  @Get()
  @ResponseMessage('Standards retrieved successfully')
  @ApiOperation({ summary: 'List standards in the active organisation' })
  @ApiOkResponse({
    description: 'Paginated standards',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(StandardResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<StandardResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.standardsService.findAll(user, query).then(
      (result) =>
        new PaginatedResult(
          result.items.map((item) => this.toResponseDto(item)),
          result.meta,
        ),
    );
  }

  @Get(':id')
  @ResponseMessage('Standard retrieved successfully')
  @ApiOperation({ summary: 'Get standard by id' })
  @ApiOkResponse({
    description: 'Standard details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(StandardResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Standard not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StandardResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.standardsService
      .findOne(user, id)
      .then((standard) => this.toResponseDto(standard));
  }

  @Patch(':id')
  @ResponseMessage('Standard updated successfully')
  @ApiOperation({ summary: 'Update standard by id' })
  @ApiOkResponse({
    description: 'Updated standard',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(StandardResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Standard code already exists',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Standard or programme not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStandardDto,
  ): Promise<StandardResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.standardsService
      .update(user, id, dto)
      .then((standard) => this.toResponseDto(standard));
  }

  private toResponseDto(standard: Standard): StandardResponseDto {
    return {
      id: standard.id,
      organisationId: standard.organisationId,
      programmeId: standard.programmeId,
      code: standard.code,
      title: standard.title,
      description: standard.description,
      fundingBandMax:
        standard.fundingBandMax !== null
          ? Number(standard.fundingBandMax)
          : null,
      defaultDurationMonths: standard.defaultDurationMonths,
      status: standard.status,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Standard deleted successfully')
  @ApiOperation({ summary: 'Soft-delete standard by id' })
  @ApiNoContentResponse({ description: 'Standard deleted' })
  @ApiNotFoundResponse({
    description: 'Standard not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.standardsService.remove(user, id);
  }
}
