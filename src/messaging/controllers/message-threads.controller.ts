import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ActiveOrganisationGuard } from '../../auth/guards/active-organisation.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { ORGANISATION_ID_HEADER } from '../../common/constants/organisation-headers.js';
import { setCurrentUserId } from '../../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../../common/dto/error-response.dto.js';
import { ResponseMessage } from '../../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { ListMessageThreadsQueryDto } from '../dto/list-message-threads-query.dto.js';
import { MessageThreadResponseDto } from '../dto/message-thread-response.dto.js';
import { MessagingUnreadCountResponseDto } from '../dto/messaging-unread-count-response.dto.js';
import { MessageThreadsService } from '../message-threads.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@ApiTags('Messaging')
@ApiExtraModels(
  MessageThreadResponseDto,
  MessagingUnreadCountResponseDto,
  ListMessageThreadsQueryDto,
)
@Controller({ path: 'messaging/threads', version: '1' })
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
  description: 'No active organisation context or thread access denied',
  type: ErrorResponseDto,
})
export class MessageThreadsController {
  constructor(private readonly threadsService: MessageThreadsService) {}

  @Get('unread-count')
  @ResponseMessage('Messaging unread count retrieved successfully')
  @ApiOperation({
    summary: 'Get total unread message count for the current user',
    description:
      'Returns the aggregate unread count across all messaging threads ' +
      'the user can access (participant or org admin for safeguarding). ' +
      'Used for the messaging nav badge.',
  })
  @ApiOkResponse({
    description: 'Unread message count',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MessagingUnreadCountResponseDto) },
      },
    },
  })
  getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.threadsService.getUnreadCount(user);
  }

  @Get()
  @ResponseMessage('Message threads retrieved successfully')
  @ApiOperation({
    summary: 'List direct messaging threads',
    description:
      'Returns tutor and line-manager threads for an enrolment or apprentice. ' +
      'When enrolmentId is provided, threads are provisioned automatically if ' +
      'participant user IDs are assigned. Org admins can view all threads for safeguarding.',
  })
  @ApiOkResponse({
    description: 'Accessible message threads with per-thread unread counts',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(MessageThreadResponseDto) },
        },
      },
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMessageThreadsQueryDto,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.threadsService.list(user, query);
  }

  @Get(':id')
  @ResponseMessage('Message thread retrieved successfully')
  @ApiOperation({
    summary: 'Get a message thread by id',
    description:
      'Returns thread metadata including unread count. Archived threads remain readable but read-only.',
  })
  @ApiOkResponse({
    description: 'Message thread details',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(MessageThreadResponseDto) },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Thread not found',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.threadsService.findOne(user, id);
  }

  @Patch(':id/read')
  @ResponseMessage('Message thread marked as read successfully')
  @ApiOperation({
    summary: 'Mark all messages in a thread as read for the current user',
    description:
      'Updates the read cursor for the current user, clearing the unread badge for this thread.',
  })
  @ApiOkResponse({
    description: 'Thread marked read',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { type: 'null' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Thread not found',
    type: ErrorResponseDto,
  })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    await this.threadsService.markRead(user, id);
    return null;
  }
}
