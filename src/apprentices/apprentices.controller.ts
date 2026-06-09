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

import { ApprenticesService } from './apprentices.service.js';
import { ApprenticeResponseDto } from './dto/apprentice-response.dto.js';
import { CreateApprenticeDto } from './dto/create-apprentice.dto.js';
import { UpdateApprenticeDto } from './dto/update-apprentice.dto.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Apprentices')
@ApiExtraModels(ApprenticeResponseDto, PaginationMetaDto)
@Controller({ path: 'apprentices', version: '1' })
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
export class ApprenticesController {
  constructor(private readonly apprenticesService: ApprenticesService) {}

  @Post()
  @ResponseMessage('Apprentice created successfully')
  @ApiOperation({ summary: 'Create an apprentice in the active organisation' })
  @ApiCreatedResponse({
    description: 'Apprentice created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ApprenticeResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Apprentice with email already exists in organisation',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApprenticeDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.apprenticesService.create(user, dto);
  }

  @Get()
  @ResponseMessage('Apprentices retrieved successfully')
  @ApiOperation({ summary: 'List apprentices in the active organisation' })
  @ApiOkResponse({
    description: 'Paginated apprentice list',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ApprenticeResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ApprenticeResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.apprenticesService.findAll(user, query);
  }

  @Get(':id')
  @ResponseMessage('Apprentice retrieved successfully')
  @ApiOperation({ summary: 'Get apprentice by id' })
  @ApiOkResponse({
    description: 'Apprentice details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ApprenticeResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Apprentice not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.apprenticesService.findOne(user, id);
  }

  @Patch(':id')
  @ResponseMessage('Apprentice updated successfully')
  @ApiOperation({ summary: 'Update apprentice in active organisation' })
  @ApiOkResponse({
    description: 'Updated apprentice',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ApprenticeResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Apprentice with email already exists in organisation',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Apprentice not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApprenticeDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.apprenticesService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Apprentice deleted successfully')
  @ApiOperation({ summary: 'Soft-delete apprentice in active organisation' })
  @ApiNoContentResponse({ description: 'Apprentice deleted' })
  @ApiNotFoundResponse({
    description: 'Apprentice not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.apprenticesService.remove(user, id);
  }
}
