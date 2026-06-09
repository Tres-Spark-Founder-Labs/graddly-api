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

import { CreateProgrammeDto } from './dto/create-programme.dto.js';
import { ProgrammeResponseDto } from './dto/programme-response.dto.js';
import { UpdateProgrammeDto } from './dto/update-programme.dto.js';
import { ProgrammesService } from './programmes.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Programmes')
@ApiExtraModels(ProgrammeResponseDto, PaginationMetaDto)
@Controller({ path: 'programmes', version: '1' })
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
export class ProgrammesController {
  constructor(private readonly programmesService: ProgrammesService) {}

  @Post()
  @ResponseMessage('Programme created successfully')
  @ApiOperation({ summary: 'Create a programme in the active organisation' })
  @ApiCreatedResponse({
    description: 'Programme created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ProgrammeResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Programme code already exists',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProgrammeDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.programmesService.create(user, dto);
  }

  @Get()
  @ResponseMessage('Programmes retrieved successfully')
  @ApiOperation({ summary: 'List programmes in the active organisation' })
  @ApiOkResponse({
    description: 'Paginated programmes',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(ProgrammeResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ProgrammeResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.programmesService.findAll(user, query);
  }

  @Get(':id')
  @ResponseMessage('Programme retrieved successfully')
  @ApiOperation({ summary: 'Get programme by id' })
  @ApiOkResponse({
    description: 'Programme details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ProgrammeResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Programme not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.programmesService.findOne(user, id);
  }

  @Patch(':id')
  @ResponseMessage('Programme updated successfully')
  @ApiOperation({ summary: 'Update programme by id' })
  @ApiOkResponse({
    description: 'Updated programme',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(ProgrammeResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Programme code already exists',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Programme not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProgrammeDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.programmesService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Programme deleted successfully')
  @ApiOperation({ summary: 'Soft-delete programme by id' })
  @ApiNoContentResponse({ description: 'Programme deleted' })
  @ApiNotFoundResponse({
    description: 'Programme not found',
    type: ErrorResponseDto,
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.programmesService.remove(user, id);
  }
}
