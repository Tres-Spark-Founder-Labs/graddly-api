import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
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
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { LearnerAccessible } from '../../common/learner-scope/learner-accessible.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { PresignedUploadResponseDto } from '../../storage/dto/create-presigned-upload.dto.js';
import { CreateMessageAttachmentUploadUrlDto } from '../dto/create-message.dto.js';
import { MessageAttachmentsService } from '../message-attachments.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Messaging')
@ApiExtraModels(PresignedUploadResponseDto, CreateMessageAttachmentUploadUrlDto)
@Controller({ path: 'messaging/attachments', version: '1' })
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
export class MessageAttachmentsController {
  constructor(private readonly attachmentsService: MessageAttachmentsService) {}

  @LearnerAccessible()
  @Post('upload-url')
  @ResponseMessage('Messaging attachment upload URL created successfully')
  @ApiOperation({
    summary: 'Create a presigned upload URL for a message attachment',
    description:
      'Returns a presigned S3 PUT URL for a messaging attachment (max 10 MB per PRD). ' +
      'Upload the file directly to S3, then reference the returned key when sending a message. ' +
      'Keys are stored under orgs/{orgId}/learners/{apprenticeId}/attachment/.',
  })
  @ApiCreatedResponse({
    description: 'Presigned upload URL and storage key',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PresignedUploadResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'File exceeds 10 MB or MIME type not allowed',
    type: ErrorResponseDto,
  })
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMessageAttachmentUploadUrlDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.attachmentsService.createUploadUrl(user, dto);
  }
}
