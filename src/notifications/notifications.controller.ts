import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
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
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { PaginationMetaDto } from '../common/dto/pagination-meta.dto.js';
import { ValidationException } from '../common/exceptions/validation.exception.js';
import { ResponseMessage } from '../common/interceptors/response-message.decorator.js';
import { LearnerAccessible } from '../common/learner-scope/learner-accessible.decorator.js';

import {
  DigestPreferenceResponseDto,
  UpdateDigestPreferenceDto,
} from './dto/digest-preference.dto.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { MarkAllNotificationsReadDto } from './dto/mark-all-notifications-read.dto.js';
import {
  NotificationChannelPreferenceDto,
  NotificationPreferencesResponseDto,
  NotificationTypePreferencesDto,
  UpdateNotificationPreferenceItemDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto.js';
import { NotificationResponseDto } from './dto/notification-response.dto.js';
import {
  CreatePushSubscriptionDto,
  PushPublicKeyResponseDto,
  PushSubscriptionKeysDto,
  PushSubscriptionResponseDto,
} from './dto/push-subscription.dto.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { isConfigurablePreference } from './notification-type-catalogue.js';
import { NotificationsService } from './notifications.service.js';
import { PushNotificationsService } from './push-notifications.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PaginatedResult } from '../common/pagination/paginated-result.js';

@ApiTags('Notifications')
@ApiExtraModels(
  NotificationResponseDto,
  PaginationMetaDto,
  DigestPreferenceResponseDto,
  NotificationPreferencesResponseDto,
  NotificationTypePreferencesDto,
  NotificationChannelPreferenceDto,
  UpdateNotificationPreferencesDto,
  UpdateNotificationPreferenceItemDto,
  PushPublicKeyResponseDto,
  PushSubscriptionResponseDto,
  CreatePushSubscriptionDto,
  PushSubscriptionKeysDto,
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
    private readonly pushService: PushNotificationsService,
  ) {}

  /**
   * F3.4.3 AC4 — web push. The browser asks for the server's VAPID public key
   * before subscribing; null means push is not configured here and the client
   * must not offer it. Declared before `:id/read`.
   */
  @LearnerAccessible()
  @Get('push-subscriptions/public-key')
  @ResponseMessage('Web push public key retrieved successfully')
  @ApiOperation({
    summary: 'The VAPID public key browsers subscribe with',
    description:
      'Pass as applicationServerKey to PushManager.subscribe(). Null when ' +
      'web push is not configured on this server.',
  })
  @ApiOkResponse({
    description: 'The public key, or null',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PushPublicKeyResponseDto) },
      },
    },
  })
  getPushPublicKey(): PushPublicKeyResponseDto {
    return { publicKey: this.pushService.publicKey() };
  }

  /**
   * Stores this browser's subscription for the current user. The body is
   * `PushSubscription.toJSON()` as the browser produces it. Idempotent on the
   * endpoint.
   */
  @LearnerAccessible()
  @Post('push-subscriptions')
  @ResponseMessage('Push subscription saved successfully')
  @ApiOperation({ summary: 'Subscribe this browser to web push' })
  @ApiCreatedResponse({
    description: 'The stored subscription',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(PushSubscriptionResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Not a web push subscription',
    type: ErrorResponseDto,
  })
  async createPushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<PushSubscriptionResponseDto> {
    setCurrentUserId(user.id);
    const saved = await this.pushService.subscribe(user.id, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent:
        typeof userAgent === 'string' && userAgent.trim() !== ''
          ? userAgent.slice(0, 512)
          : null,
    });
    return {
      id: saved.id,
      endpoint: saved.endpoint,
      userAgent: saved.userAgent,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  /**
   * Retires this browser's subscription. The endpoint comes as a query
   * parameter: a DELETE body does not reliably survive the portals' BFF, and
   * the endpoint is the only identity the browser holds.
   */
  @LearnerAccessible()
  @Delete('push-subscriptions')
  @HttpCode(200)
  @ResponseMessage('Push subscription removed successfully')
  @ApiOperation({ summary: 'Unsubscribe this browser from web push' })
  @ApiOkResponse({
    description: 'How many subscriptions were removed (0 or 1)',
    schema: {
      properties: {
        message: { type: 'string' },
        data: {
          type: 'object',
          properties: { removed: { type: 'number' } },
        },
      },
    },
  })
  async deletePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Query('endpoint') endpoint: string,
  ): Promise<{ removed: number }> {
    setCurrentUserId(user.id);
    if (typeof endpoint !== 'string' || endpoint.trim() === '') {
      throw new ValidationException({ endpoint: 'endpoint is required' });
    }
    return { removed: await this.pushService.unsubscribe(user.id, endpoint) };
  }

  @LearnerAccessible()
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
    return this.notificationsService.listForUser(
      user.id,
      query,
      user.organisationId,
    );
  }

  @LearnerAccessible()
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
    return this.notificationsService.markAllRead(
      user.id,
      dto.organisationId ?? user.organisationId ?? undefined,
    );
  }

  /**
   * F3.4.3 AC3 — the current user's notification preferences: every
   * (channel, type) pair, labelled, with whether each can be changed.
   *
   * Per user, so there is no organisation in it — the preference follows the
   * person across every organisation they belong to (migration
   * 1781100000057 says why). Declared before `:id/read`.
   */
  @LearnerAccessible()
  @Get('preferences')
  @ResponseMessage('Notification preferences retrieved successfully')
  @ApiOperation({
    summary: 'Get the current user notification preferences',
    description:
      'Every (channel, type) pair with its enabled state; an absent choice ' +
      'is enabled. `configurable` marks the pairs PATCH accepts: email, for ' +
      'the types the platform emails.',
  })
  @ApiOkResponse({
    description: 'Every (channel, type) pair',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(NotificationPreferencesResponseDto) },
      },
    },
  })
  async getPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferencesResponseDto> {
    setCurrentUserId(user.id);
    return this.preferencesService.listForUser(user.id);
  }

  /**
   * F3.4.3 AC3 — set per-type preferences. Only configurable pairs are
   * accepted, each at most once: a stored setting nothing acts on would
   * tell the person they had switched something off that still arrives.
   * The digest endpoints below are unchanged.
   */
  @LearnerAccessible()
  @Patch('preferences')
  @ResponseMessage('Notification preferences updated successfully')
  @ApiOperation({
    summary: 'Set the current user notification preferences',
    description:
      'Upserts each { channel, type, enabled }. Refused, naming the pair, ' +
      'when a pair is not configurable or appears twice.',
  })
  @ApiOkResponse({
    description: 'Every (channel, type) pair, after the change',
    schema: {
      properties: {
        message: { type: 'string' },
        data: { $ref: getSchemaPath(NotificationPreferencesResponseDto) },
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'A pair is not configurable, or appears twice',
    type: ErrorResponseDto,
  })
  async updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    setCurrentUserId(user.id);

    const seen = new Set<string>();
    for (const item of dto.preferences) {
      const key = `${item.channel}:${item.type}`;
      if (seen.has(key)) {
        throw new ValidationException({
          preferences: `${item.channel} for ${item.type} appears more than once`,
        });
      }
      seen.add(key);
      if (!isConfigurablePreference(item.channel, item.type)) {
        throw new ValidationException({
          preferences:
            `${item.channel} for ${item.type} cannot be set here: only email, ` +
            'for a type the platform emails, is configurable',
        });
      }
    }

    return this.preferencesService.setForUser(user.id, dto.preferences);
  }

  /**
   * F1.2.3 AC7. Declared before `:id/read` so the literal path is matched
   * first and never shadowed by the parameterised route.
   *
   * Scoped to the OTJ digest because that is the only digest the platform
   * sends; a `type` parameter would be generality with nothing behind it.
   */
  @LearnerAccessible()
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
    const frequency = await this.preferencesService.getDigestFrequency(
      user.id,
      NotificationType.OTJ,
    );
    return { type: NotificationType.OTJ, frequency };
  }

  @LearnerAccessible()
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
    const saved = await this.preferencesService.setDigestFrequency(
      user.id,
      NotificationType.OTJ,
      dto.frequency,
    );
    return { type: NotificationType.OTJ, frequency: saved.frequency };
  }

  @LearnerAccessible()
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
    return this.notificationsService.markRead(user.id, id);
  }
}
