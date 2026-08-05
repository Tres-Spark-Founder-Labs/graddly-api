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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { Capability } from '../auth/capabilities/capability.enum.js';
import { RequiresCapability } from '../auth/capabilities/requires-capability.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../auth/guards/active-organisation.guard.js';
import { CapabilityGuard } from '../auth/guards/capability.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import { CreateIlrMappingConfigDto } from './dto/create-ilr-mapping-config.dto.js';
import { IlrMappingConfigResponseDto } from './dto/ilr-mapping-config-response.dto.js';
import { IlrMappingConfigService } from './ilr-mapping-config.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@ApiTags('ILR Mapping Configs')
@ApiExtraModels(IlrMappingConfigResponseDto)
@Controller({ path: 'ilr/mapping-configs', version: '1' })
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
export class IlrMappingConfigsController {
  constructor(private readonly service: IlrMappingConfigService) {}

  @Get()
  @ResponseMessage('ILR mapping configs retrieved successfully')
  @ApiOperation({ summary: 'List ILR mapping config versions' })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(IlrMappingConfigResponseDto) },
        },
      },
    },
  })
  findAll(): Promise<IlrMappingConfigResponseDto[]> {
    return this.service.findAll();
  }

  @Get('active')
  @ResponseMessage('Active ILR mapping config retrieved successfully')
  @ApiOperation({
    summary: 'Get published mapping config for an academic year',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrMappingConfigResponseDto) },
      },
    },
  })
  findActive(
    @Query('academicYear') academicYear: string,
  ): Promise<IlrMappingConfigResponseDto> {
    return this.service.findActivePublished(academicYear);
  }

  @Post()
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_ILR_MAPPING)
  @ResponseMessage('ILR mapping config draft created successfully')
  @ApiOperation({
    summary: 'Create a draft ILR mapping config version (owner or admin)',
  })
  @ApiCreatedResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrMappingConfigResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateIlrMappingConfigDto,
  ): Promise<IlrMappingConfigResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.createDraft(user, dto);
  }

  @Post(':id/publish')
  @UseGuards(CapabilityGuard)
  @RequiresCapability(Capability.MANAGE_ILR_MAPPING)
  @ResponseMessage('ILR mapping config published successfully')
  @ApiOperation({
    summary: 'Publish a draft ILR mapping config (owner or admin)',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(IlrMappingConfigResponseDto) },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions',
    type: ErrorResponseDto,
  })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IlrMappingConfigResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.service.publish(user, id);
  }
}
