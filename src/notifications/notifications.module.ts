import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailModule } from '../email/email.module.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { User } from '../users/entities/user.entity.js';

import { DigestDispatchService } from './digest-dispatch.service.js';
import { NotificationPreference } from './entities/notification-preference.entity.js';
import { Notification } from './entities/notification.entity.js';
import { PushSubscription } from './entities/push-subscription.entity.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { OtjDigestService } from './otj-digest.service.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { WebPushClient } from './web-push.client.js';

@Module({
  imports: [
    EmailModule,
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      PushSubscription,
      OtjLogEntry,
      User,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    PushNotificationsService,
    WebPushClient,
    DigestDispatchService,
    OtjDigestService,
  ],
  exports: [
    NotificationsService,
    NotificationPreferencesService,
    PushNotificationsService,
    DigestDispatchService,
    OtjDigestService,
  ],
})
export class NotificationsModule {}
