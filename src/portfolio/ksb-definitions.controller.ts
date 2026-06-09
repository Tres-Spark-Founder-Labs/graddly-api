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
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
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

import { CreateKsbDefinitionDto } from './dto/create-ksb-definition.dto.js';
import { KsbDefinitionResponseDto } from './dto/ksb-definition-response.dto.js';
import { UpdateKsbDefinitionDto } from './dto/update-ksb-definition.dto.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('KSB Definitions')
@ApiExtraModels(KsbDefinitionResponseDto)
@Controller({ path: '', version: '1' })
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
export class KsbDefinitionsController {
  constructor(private readonly service: KsbDefinitionsService) {}

  @Post('standards/:standardId/ksb-definitions')
  @ResponseMessage('KSB definition created successfully')
  @ApiOperation({ summary: 'Create a KSB definition on a standard' })
  @ApiCreatedResponse({
    description: 'KSB definition created',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(KsbDefinitionResponseDto) },
      },
    },
  })
  createForStandard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('standardId', ParseUUIDPipe) standardId: string,
    @Body() dto: CreateKsbDefinitionDto,
  ): Promise<KsbDefinitionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.createForStandard(user, standardId, dto);
  }

  @Get('standards/:standardId/ksb-definitions')
  @ResponseMessage('KSB definitions retrieved successfully')
  @ApiOperation({ summary: 'List KSB definitions for a standard' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(KsbDefinitionResponseDto) },
        },
      },
    },
  })
  findByStandard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('standardId', ParseUUIDPipe) standardId: string,
  ): Promise<KsbDefinitionResponseDto[]> {
    return this.service.findByStandard(user, standardId);
  }

  @Patch('ksb-definitions/:id')
  @ResponseMessage('KSB definition updated successfully')
  @ApiOperation({ summary: 'Update a KSB definition' })
  @ApiOkResponse({
    description: 'Updated KSB definition',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(KsbDefinitionResponseDto) },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKsbDefinitionDto,
  ): Promise<KsbDefinitionResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.update(user, id, dto);
  }

  @Delete('ksb-definitions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseMessage('KSB definition deleted successfully')
  @ApiOperation({ summary: 'Soft-delete a KSB definition' })
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.service.remove(user, id);
  }
}
