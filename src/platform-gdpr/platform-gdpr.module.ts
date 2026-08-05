import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmployerVisit } from '../employer-visits/entities/employer-visit.entity.js';
import { BreakInLearning } from '../enrolments/entities/break-in-learning.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { FundingClaimResolution } from '../ilr/entities/funding-claim-resolution.entity.js';
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
      // Security pass item 5 — erasure now scrubs free text on these too.
      BreakInLearning,
      EmployerVisit,
      FundingClaimResolution,
      AuditLogEntry,
    ]),
  ],
  controllers: [PlatformGdprController],
  providers: [ErasureService, PlatformOpsApiKeyGuard],
  exports: [ErasureService, PlatformOpsApiKeyGuard],
})
export class PlatformGdprModule {}
