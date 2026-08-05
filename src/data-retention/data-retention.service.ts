import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';

const BATCH_SIZE = 500;

export type RetentionRunSummary = {
  auditLogsPurged: number;
  softDeletedPurged: number;
  oldNotificationsPurged: number;
};

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AuditLogEntry)
    private readonly auditRepo: Repository<AuditLogEntry>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(MessageThread)
    private readonly messageThreadRepo: Repository<MessageThread>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Invitation)
    private readonly invitationRepo: Repository<Invitation>,
  ) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('app.cron.retentionEnabled', false);
  }

  async runRetentionJob(options?: {
    force?: boolean;
  }): Promise<RetentionRunSummary> {
    if (!options?.force && !this.isEnabled()) {
      this.logger.debug('Retention cron disabled; skipping');
      return {
        auditLogsPurged: 0,
        softDeletedPurged: 0,
        oldNotificationsPurged: 0,
      };
    }

    const auditLogsPurged = await this.purgeExpiredAuditLogs();
    const softDeleteDays = this.config.get<number>(
      'app.retention.softDeleteDays',
      90,
    );
    const softDeletedPurged =
      await this.purgeSoftDeletedRecords(softDeleteDays);
    const notificationDays = this.config.get<number>(
      'app.retention.notificationDays',
      365,
    );
    const oldNotificationsPurged =
      await this.purgeOldReadNotifications(notificationDays);

    return { auditLogsPurged, softDeletedPurged, oldNotificationsPurged };
  }

  /**
   * Security hardening pass, item 7 — this cannot work, and must not be
   * "fixed" by adding tenant context.
   *
   * Two deliberate decisions in this codebase contradict each other:
   *
   *  - Migration `1781100000027` makes `audit_log_entries` append-only. Its
   *    trigger RAISEs on DELETE — "erasure scrubs rows, it does not remove
   *    them" — and it fires for every role, superuser included. Proven by
   *    attempting a delete as the migration role:
   *      `ERROR: audit_log_entries is append-only: entry ... cannot be deleted`
   *  - This method deletes audit rows older than `app.retention.auditYears`.
   *
   * It has never failed only because the sweep ran with no tenant context, so
   * the SELECT that feeds `batchDelete` returned zero rows and it broke out
   * before attempting a delete. The tenancy bug was masking the conflict.
   *
   * Adding bootstrap here — the fix applied to every other sweep in this pass
   * — would make the SELECT return rows and the DELETE throw, converting a
   * silent no-op into a nightly crash. So this stays a no-op, but an
   * **explicit and logged** one rather than an accidental one.
   *
   * Which of the two duties wins is a legal question (UK GDPR storage
   * limitation against an immutable audit trail), not an engineering one. It
   * is question 17 in DECISIONS-FOR-CLIENT.md. The safer default is
   * implemented: keep the audit trail.
   */
  // Kept async so the public contract is unchanged for callers, even though
  // the body is now a deliberate no-op.
  // eslint-disable-next-line @typescript-eslint/require-await
  async purgeExpiredAuditLogs(): Promise<number> {
    const years = this.config.get<number>('app.retention.auditYears', 7);
    this.logger.warn(
      `Audit log retention (${years}y) is not enforced: audit_log_entries is ` +
        'append-only by trigger and refuses DELETE for every role. See ' +
        'DECISIONS-FOR-CLIENT.md question 17.',
    );
    return 0;
  }

  async purgeSoftDeletedRecords(ttlDays: number): Promise<number> {
    const cutoff = this.daysAgo(ttlDays);
    let total = 0;
    for (const repo of [
      this.notificationRepo,
      this.messageRepo,
      this.messageThreadRepo,
      this.invitationRepo,
    ]) {
      const alias = repo.metadata.tableName.slice(0, 3);
      total += await this.batchDelete(
        repo,
        alias,
        `${alias}.isDeleted = true AND ${alias}.deletedAt < :cutoff`,
        { cutoff },
      );
    }
    return total;
  }

  async purgeOldReadNotifications(ttlDays: number): Promise<number> {
    const cutoff = this.daysAgo(ttlDays);
    return this.batchDelete(
      this.notificationRepo,
      'n',
      'n.readAt IS NOT NULL AND n.createdAt < :cutoff',
      { cutoff },
    );
  }

  /**
   * Security hardening pass, item 7 — retention is a cross-tenant sweep.
   *
   * There is no signed-in user on a cron, so every organisation-keyed policy
   * matched nothing and the SELECT below returned zero rows: retention purged
   * NOTHING, on any table, and reported a clean run. Soft-deleted rows and
   * read notifications accumulated indefinitely.
   *
   * Bootstrap sits here rather than at each caller because this is the single
   * choke point all the purges go through, and a purge is by definition
   * platform-wide — unlike the other sweeps fixed in this pass, there is no
   * per-organisation phase to hand over to.
   */
  private async batchDelete(
    repo: Repository<object>,
    alias: string,
    where: string,
    params: Record<string, Date>,
  ): Promise<number> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return await this.batchDeleteScoped(repo, alias, where, params);
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async batchDeleteScoped(
    repo: Repository<object>,
    alias: string,
    where: string,
    params: Record<string, Date>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const batch = await repo
        .createQueryBuilder(alias)
        .select(`${alias}.id`, 'id')
        .where(where, params)
        .orderBy(`${alias}.id`, 'ASC')
        .limit(BATCH_SIZE)
        .getRawMany<{ id: string }>();

      if (batch.length === 0) {
        break;
      }

      const ids = batch.map((row) => row.id);
      const result = await repo
        .createQueryBuilder()
        .delete()
        .whereInIds(ids)
        .execute();
      total += result.affected ?? 0;

      if (batch.length < BATCH_SIZE) {
        break;
      }
    }
    return total;
  }

  yearsAgo(years: number): Date {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() - years);
    return date;
  }

  daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
