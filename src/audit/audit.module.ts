import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';

import { AuditEventService } from './audit-event.service.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditController } from './audit.controller.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([AuditLogEntry])],
  controllers: [AuditController],
  providers: [AuditExportService, AuditEventService],
  exports: [AuditExportService, AuditEventService],
})
export class AuditModule {}
