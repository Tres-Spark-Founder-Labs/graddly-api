import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { BullmqModule } from '../bullmq/bullmq.module.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { MessageAttachmentsController } from './controllers/message-attachments.controller.js';
import { MessageThreadsController } from './controllers/message-threads.controller.js';
import { MessagesController } from './controllers/messages.controller.js';
import { MessageAttachment } from './entities/message-attachment.entity.js';
import { MessageThreadRead } from './entities/message-thread-read.entity.js';
import { MessageThread } from './entities/message-thread.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageAttachmentsService } from './message-attachments.service.js';
import { MessageNotificationDispatchService } from './message-notification-dispatch.service.js';
import { MessageThreadsService } from './message-threads.service.js';
import { MessagesService } from './messages.service.js';
import { MessagingAccessService } from './messaging-access.service.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    EmailModule,
    BullmqModule,
    NotificationsModule,
    forwardRef(() => EnrolmentsModule),
    TypeOrmModule.forFeature([
      MessageThread,
      Message,
      MessageAttachment,
      MessageThreadRead,
      Enrolment,
      NotificationPreference,
      User,
    ]),
  ],
  controllers: [
    MessageThreadsController,
    MessagesController,
    MessageAttachmentsController,
  ],
  providers: [
    MessagingAccessService,
    MessageThreadsService,
    MessagesService,
    MessageAttachmentsService,
    MessageNotificationDispatchService,
  ],
  exports: [MessageThreadsService, MessagesService],
})
export class MessagingModule {}
