import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditEventService } from './audit-event.service.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';

/**
 * `AuditEventService` on its own, with no dependency on AuthModule.
 *
 * ── WHY IT IS SPLIT OUT OF AuditModule ──────────────────────────────────────
 *
 * `AuditModule` imports `AuthModule` for the guards on `AuditController`, and
 * `AuthModule` imports `UsersModule`. So a service that needs to record an
 * audit event from inside `UsersModule` — which is where the MFA and password
 * writes live — cannot import `AuditModule` without closing the cycle
 * UsersModule → AuditModule → AuthModule → UsersModule.
 *
 * The recorder itself needs nothing but the repository, so it moves here and
 * `AuditModule` re-exports this module. Existing consumers that import
 * `AuditModule` are unaffected. This is the same split `OutcomeMetricsModule`
 * made out of `ReportingModule`, for the same reason and with the same
 * outcome: the leaf has no cycle to close.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntry])],
  providers: [AuditEventService],
  exports: [AuditEventService],
})
export class AuditEventModule {}
