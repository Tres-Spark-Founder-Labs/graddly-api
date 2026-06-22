import { Test } from '@nestjs/testing';

import { DataRetentionService } from '../data-retention/data-retention.service.js';
import { RetentionRunTrigger } from '../data-retention/enums/retention-run-trigger.enum.js';
import { RetentionRunLogService } from '../data-retention/retention-run-log.service.js';

import { PlatformRetentionService } from './platform-retention.service.js';

describe('PlatformRetentionService', () => {
  let service: PlatformRetentionService;
  const runRetentionJob = jest.fn();
  const recordRun = jest.fn();
  const listRuns = jest.fn();

  beforeEach(async () => {
    runRetentionJob.mockReset();
    recordRun.mockReset();
    listRuns.mockReset();

    runRetentionJob.mockResolvedValue({
      auditLogsPurged: 1,
      softDeletedPurged: 0,
      oldNotificationsPurged: 2,
    });
    recordRun.mockResolvedValue({
      id: 'log-1',
      ranAt: new Date('2026-06-08T12:00:00.000Z'),
      triggeredBy: RetentionRunTrigger.MANUAL,
      auditLogsPurged: 1,
      softDeletedPurged: 0,
      oldNotificationsPurged: 2,
    });
    listRuns.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          ranAt: new Date('2026-06-08T12:00:00.000Z'),
          triggeredBy: RetentionRunTrigger.CRON,
          auditLogsPurged: 0,
          softDeletedPurged: 0,
          oldNotificationsPurged: 0,
        },
      ],
      meta: {
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformRetentionService,
        {
          provide: DataRetentionService,
          useValue: { runRetentionJob },
        },
        {
          provide: RetentionRunLogService,
          useValue: { recordRun, listRuns },
        },
      ],
    }).compile();

    service = moduleRef.get(PlatformRetentionService);
  });

  it('runs manual retention with force and records the run', async () => {
    const result = await service.runManual();

    expect(runRetentionJob).toHaveBeenCalledWith({ force: true });
    expect(recordRun).toHaveBeenCalledWith(
      RetentionRunTrigger.MANUAL,
      expect.objectContaining({ auditLogsPurged: 1 }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'log-1',
        triggeredBy: RetentionRunTrigger.MANUAL,
        auditLogsPurged: 1,
      }),
    );
  });

  it('maps paginated run history to DTOs', async () => {
    const result = await service.listRuns({ page: 1, perPage: 20 });

    expect(listRuns).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'log-1',
        triggeredBy: RetentionRunTrigger.CRON,
        ranAt: '2026-06-08T12:00:00.000Z',
      }),
    );
  });
});
