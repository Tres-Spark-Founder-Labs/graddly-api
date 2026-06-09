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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { CreateMessageDto } from '../dto/create-message.dto.js';
import { MessageResponseDto } from '../dto/message-response.dto.js';
import { MessagesService } from '../messages.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Messaging')
@ApiExtraModels(MessageResponseDto, PaginationMetaDto, CreateMessageDto)
@Controller({ path: 'messaging/threads/:threadId/messages', version: '1' })
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
  description: 'Not a thread participant or thread is archived',
  type: ErrorResponseDto,
})
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @ResponseMessage('Messages retrieved successfully')
  @ApiOperation({
    summary: 'List messages in a thread',
    description:
      'Returns paginated message history in reverse chronological order. ' +
      'Org admins may read threads for safeguarding; messages are not end-to-end encrypted.',
  })
  @ApiOkResponse({
    description: 'Paginated messages',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(MessageResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Thread not found',
    type: ErrorResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query() query: PaginationQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.messagesService.list(user, threadId, query);
  }

  @Post()
  @ResponseMessage('Message sent successfully')
  @ApiOperation({
    summary: 'Send a message in a thread',
    description:
      'Sends plain text (emoji supported) with optional file attachments (max 10 MB each). ' +
      'Recipients receive an in-app notification immediately and a debounced email within 5 minutes. ' +
      'Archived threads reject new messages.',
  })
  @ApiCreatedResponse({
    description: 'Created message',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MessageResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Validation failed',
    type: ValidationErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid attachment or archived thread',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Thread not found',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: CreateMessageDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.messagesService.create(user, threadId, dto);
  }
}
