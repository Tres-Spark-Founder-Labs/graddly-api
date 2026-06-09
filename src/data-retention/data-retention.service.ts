import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
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

  async runRetentionJob(): Promise<RetentionRunSummary> {
    if (!this.isEnabled()) {
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

  async purgeExpiredAuditLogs(): Promise<number> {
    const years = this.config.get<number>('app.retention.auditYears', 7);
    const cutoff = this.yearsAgo(years);
    return this.batchDelete(this.auditRepo, 'audit', 'createdAt < :cutoff', {
      cutoff,
    });
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

  private async batchDelete(
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
