import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';

import { AuditEventModule } from './audit-event.module.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditController } from './audit.controller.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';

@Module({
  imports: [
    AuthModule,
    // Re-exported below, so anything importing AuditModule still gets
    // AuditEventService. See AuditEventModule for why it is not declared here.
    AuditEventModule,
    TypeOrmModule.forFeature([AuditLogEntry]),
  ],
  controllers: [AuditController],
  providers: [AuditExportService],
  exports: [AuditExportService, AuditEventModule],
})
export class AuditModule {}
