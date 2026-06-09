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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateOrganisationDto } from './dto/create-organisation.dto.js';
import { OrganisationResponseDto } from './dto/organisation-response.dto.js';
import { UpdateOrganisationDto } from './dto/update-organisation.dto.js';
import { OrganisationsService } from './organisations.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Organisations')
@ApiExtraModels(OrganisationResponseDto)
@Controller('organisations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
export class OrganisationsController {
  constructor(private readonly organisationsService: OrganisationsService) {}

  @Post()
  @ResponseMessage('Organisation created successfully')
  @ApiOperation({
    summary: 'Create an organisation',
    description:
      'Creates a new organisation with a unique slug. Requires authentication.',
  })
  @ApiCreatedResponse({
    description: 'Organisation created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OrganisationResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Slug already in use',
    type: ErrorResponseDto,
  })
  create(
    @Body() dto: CreateOrganisationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.organisationsService.create(dto, user.id);
  }

  @Get()
  @ResponseMessage('Organisations retrieved successfully')
  @ApiOperation({ summary: 'List organisations' })
  @ApiOkResponse({
    description: 'List of organisations',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(OrganisationResponseDto) },
        },
      },
    },
  })
  findAll() {
    return this.organisationsService.findAll();
  }

  @Get(':id')
  @ResponseMessage('Organisation retrieved successfully')
  @ApiOperation({ summary: 'Get organisation by id' })
  @ApiOkResponse({
    description: 'Organisation details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OrganisationResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Organisation not found',
    type: ErrorResponseDto,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.organisationsService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Organisation updated successfully')
  @ApiOperation({ summary: 'Update organisation' })
  @ApiOkResponse({
    description: 'Updated organisation',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(OrganisationResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Organisation not found',
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Slug already in use',
    type: ErrorResponseDto,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganisationDto,
  ) {
    return this.organisationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('Organisation deleted successfully')
  @ApiOperation({ summary: 'Soft-delete organisation' })
  @ApiNoContentResponse({ description: 'Organisation deleted' })
  @ApiNotFoundResponse({
    description: 'Organisation not found',
    type: ErrorResponseDto,
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.organisationsService.remove(id);
  }
}
