import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';

import { DataRetentionService } from './data-retention.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntry,
      Notification,
      MessageThread,
      Message,
      Invitation,
    ]),
  ],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
