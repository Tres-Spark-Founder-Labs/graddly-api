import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';

import { DataRetentionService } from './data-retention.service.js';
import { RetentionRunLog } from './entities/retention-run-log.entity.js';
import { RetentionRunLogService } from './retention-run-log.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntry,
      Notification,
      MessageThread,
      Message,
      Invitation,
      RetentionRunLog,
    ]),
  ],
  providers: [DataRetentionService, RetentionRunLogService],
  exports: [DataRetentionService, RetentionRunLogService],
})
export class DataRetentionModule {}
