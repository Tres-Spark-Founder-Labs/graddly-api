import {
  Body,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { setCurrentUserId } from '../common/context/correlation-id-context.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';

import {
  DigestPreferenceResponseDto,
  UpdateDigestPreferenceDto,
} from './dto/digest-preference.dto.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { MarkAllNotificationsReadDto } from './dto/mark-all-notifications-read.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationsService } from './notifications.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PaginatedResult } from '../common/pagination/paginated-result.js';

@ApiTags('Notifications')
@ApiExtraModels(
  NotificationResponseDto,
  PaginationMetaDto,
  DigestPreferenceResponseDto,
)
@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing or invalid bearer token',
  type: ErrorResponseDto,
})
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  @ResponseMessage('Notifications retrieved successfully')
  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiOkResponse({
    description: 'Paginated notifications',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(NotificationResponseDto) },
        },
        meta: { $ref: getSchemaPath(PaginationMetaDto) },
      },
    },
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.notificationsService.listForUser(
      user.id,
      query,
      user.organisationId,
    );
  }

  @Patch('read-all')
  @ResponseMessage('Notifications marked as read')
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  @ApiOkResponse({
    description: 'Count of notifications updated',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: { updated: { type: 'number' } },
        },
      },
    },
  })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkAllNotificationsReadDto,
  ): Promise<{ updated: number }> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.notificationsService.markAllRead(
      user.id,
      dto.organisationId ?? user.organisationId ?? undefined,
    );
  }

  /**
   * F1.2.3 AC7. Declared before `:id/read` so the literal path is matched
   * first and never shadowed by the parameterised route.
   *
   * Scoped to the OTJ digest because that is the only digest the platform
   * sends; a `type` parameter would be generality with nothing behind it.
   */
  @Get('preferences/digest')
  @ResponseMessage('Digest preference retrieved successfully')
  @ApiOperation({
    summary: 'Get the current user OTJ approval digest frequency',
  })
  @ApiOkResponse({
    description: 'Current digest frequency',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DigestPreferenceResponseDto) },
      },
    },
  })
  async getDigestPreference(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DigestPreferenceResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const frequency = await this.preferencesService.getDigestFrequency(
      user.id,
      NotificationType.OTJ,
    );
    return { type: NotificationType.OTJ, frequency };
  }

  @Patch('preferences/digest')
  @ResponseMessage('Digest preference updated successfully')
  @ApiOperation({
    summary: 'Set the current user OTJ approval digest frequency',
    description:
      'daily sends every morning, weekly sends on Monday, off stops delivery.',
  })
  @ApiOkResponse({
    description: 'Updated digest frequency',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(DigestPreferenceResponseDto) },
      },
    },
  })
  async updateDigestPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDigestPreferenceDto,
  ): Promise<DigestPreferenceResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    const saved = await this.preferencesService.setDigestFrequency(
      user.id,
      NotificationType.OTJ,
      dto.frequency,
    );
    return { type: NotificationType.OTJ, frequency: saved.frequency };
  }

  @Patch(':id/read')
  @ResponseMessage('Notification marked as read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({
    description: 'Updated notification',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(NotificationResponseDto) },
      },
    },
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);
    return this.notificationsService.markRead(user.id, id);
  }
}
