import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';

import { DataRetentionService } from './data-retention.service.js';

describe('DataRetentionService', () => {
  const repoWithMetadata = (tableName: string) => ({
    metadata: { tableName },
    createQueryBuilder: jest.fn(),
  });
  const auditRepo = repoWithMetadata('audit_log_entries');
  const notificationRepo = repoWithMetadata('notifications');
  const messageThreadRepo = repoWithMetadata('message_threads');
  const messageRepo = repoWithMetadata('messages');
  const invitationRepo = repoWithMetadata('invitations');

  const configGet = jest.fn();

  let service: DataRetentionService;

  function mockBatchDelete(repo: { createQueryBuilder: jest.Mock }) {
    const selectQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const deleteQb = {
      delete: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    repo.createQueryBuilder.mockImplementation((alias?: string) =>
      alias ? selectQb : deleteQb,
    );
    return selectQb;
  }

  beforeEach(async () => {
    configGet.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'app.cron.retentionEnabled') return false;
      if (key === 'app.retention.auditYears') return 7;
      if (key === 'app.retention.softDeleteDays') return 90;
      if (key === 'app.retention.notificationDays') return 365;
      return defaultValue;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        DataRetentionService,
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: getRepositoryToken(AuditLogEntry), useValue: auditRepo },
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepo,
        },
        {
          provide: getRepositoryToken(MessageThread),
          useValue: messageThreadRepo,
        },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: getRepositoryToken(Invitation), useValue: invitationRepo },
      ],
    }).compile();

    service = moduleRef.get(DataRetentionService);
    jest.clearAllMocks();
  });

  it('computes audit cutoff from configured years', () => {
    const cutoff = service.yearsAgo(7);
    const expected = new Date();
    expected.setUTCFullYear(expected.getUTCFullYear() - 7);
    expect(cutoff.getUTCFullYear()).toBe(expected.getUTCFullYear());
  });

  it('runs purge when force is true even if cron is disabled', async () => {
    mockBatchDelete(auditRepo);
    for (const repo of [
      notificationRepo,
      messageRepo,
      messageThreadRepo,
      invitationRepo,
    ]) {
      mockBatchDelete(repo);
    }
    mockBatchDelete(notificationRepo);

    const summary = await service.runRetentionJob({ force: true });
    expect(summary).toEqual({
      auditLogsPurged: 0,
      softDeletedPurged: 0,
      oldNotificationsPurged: 0,
    });
    expect(auditRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('returns zero summary when retention cron is disabled', async () => {
    const summary = await service.runRetentionJob();
    expect(summary).toEqual({
      auditLogsPurged: 0,
      softDeletedPurged: 0,
      oldNotificationsPurged: 0,
    });
    expect(auditRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('purges expired audit logs in batches', async () => {
    mockBatchDelete(auditRepo);
    const deleted = await service.purgeExpiredAuditLogs();
    expect(deleted).toBe(0);
    expect(auditRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('reports whether retention cron is enabled', () => {
    expect(service.isEnabled()).toBe(false);
    configGet.mockImplementation((key: string) => {
      if (key === 'app.cron.retentionEnabled') return true;
      return undefined;
    });
    expect(service.isEnabled()).toBe(true);
  });

  it('computes day-based cutoff', () => {
    const cutoff = service.daysAgo(90);
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 90);
    expect(cutoff.getUTCDate()).toBe(expected.getUTCDate());
  });

  it('purges soft-deleted records in batches', async () => {
    for (const repo of [
      notificationRepo,
      messageRepo,
      messageThreadRepo,
      invitationRepo,
    ]) {
      mockBatchDelete(repo);
    }
    const deleted = await service.purgeSoftDeletedRecords(90);
    expect(deleted).toBe(0);
    expect(invitationRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('purges old read notifications in batches', async () => {
    mockBatchDelete(notificationRepo);
    const deleted = await service.purgeOldReadNotifications(365);
    expect(deleted).toBe(0);
    expect(notificationRepo.createQueryBuilder).toHaveBeenCalled();
  });
});
