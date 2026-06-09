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
  const auditRepo = { createQueryBuilder: jest.fn() };
  const notificationRepo = { createQueryBuilder: jest.fn() };
  const messageThreadRepo = { createQueryBuilder: jest.fn() };
  const messageRepo = { createQueryBuilder: jest.fn() };
  const invitationRepo = { createQueryBuilder: jest.fn() };

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
    repo.createQueryBuilder.mockReturnValue(selectQb);
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
});
