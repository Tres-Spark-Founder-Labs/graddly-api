import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
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
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import {
  CreatePresignedDownloadDto,
  PresignedDownloadResponseDto,
} from './dto/create-presigned-download.dto.js';
import {
  CreatePresignedUploadDto,
  PresignedUploadResponseDto,
} from './dto/create-presigned-upload.dto.js';
import { StorageService } from './storage.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';

@ApiTags('Storage')
@ApiExtraModels(PresignedUploadResponseDto, PresignedDownloadResponseDto)
@Controller({ path: 'storage', version: '1' })
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
  description: 'No active organisation or key not in tenant scope',
  type: ErrorResponseDto,
})
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @LearnerAccessible()
  @Post('upload-url')
  @ResponseMessage('Presigned upload URL created successfully')
  @ApiOperation({
    summary: 'Create a presigned S3 upload URL',
    description:
      'Validates mime type and 25 MB cap, then returns a short-lived PUT URL. Upload the file directly to S3 using the returned URL.',
  })
  @ApiOkResponse({
    description: 'Presigned upload URL',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PresignedUploadResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed (mime or size)',
    type: ValidationErrorResponseDto,
  })
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePresignedUploadDto,
  ): Promise<PresignedUploadResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.storageService.createUploadUrl(user.organisationId!, dto);
  }

  @Post('download-url')
  @ResponseMessage('Presigned download URL created successfully')
  @ApiOperation({
    summary: 'Create a presigned S3 download URL',
    description:
      'Returns a short-lived GET URL for an object key under the active organisation namespace.',
  })
  @ApiOkResponse({
    description: 'Presigned download URL',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PresignedDownloadResponseDto) },
      },
    },
  })
  createDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePresignedDownloadDto,
  ): Promise<PresignedDownloadResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.storageService.createDownloadUrl(user.organisationId!, dto);
  }
}
