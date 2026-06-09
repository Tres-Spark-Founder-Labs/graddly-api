import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { User } from '../users/entities/user.entity.js';

import { ErasureService } from './erasure.service.js';
import { PlatformGdprController } from './platform-gdpr.controller.js';
import { PlatformOpsApiKeyGuard } from './platform-ops-api-key.guard.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      User,
      Apprentice,
      Enrolment,
      OtjLogEntry,
      Message,
      AuditLogEntry,
    ]),
  ],
  controllers: [PlatformGdprController],
  providers: [ErasureService, PlatformOpsApiKeyGuard],
  exports: [ErasureService],
})
export class PlatformGdprModule {}
