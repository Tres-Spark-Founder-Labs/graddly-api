import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CronLockService } from '../scheduler/cron-lock.service.js';
import { RETENTION_CRON_NAME } from '../scheduler/scheduler.constants.js';

import { DataRetentionCronService } from './data-retention-cron.service.js';
import { DataRetentionService } from './data-retention.service.js';

describe('DataRetentionCronService', () => {
  let service: DataRetentionCronService;
  let retentionService: jest.Mocked<
    Pick<DataRetentionService, 'runRetentionJob'>
  >;
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    retentionService = { runRetentionJob: jest.fn() };
    schedulerRegistry = {
      addCronJob: jest.fn((name: string, job: { stop: jest.Mock }) => {
        cronJobs.set(name, job);
      }),
      doesExist: jest.fn((_type: string, name: string) => cronJobs.has(name)),
      getCronJob: jest.fn((name: string) => cronJobs.get(name)),
      deleteCronJob: jest.fn((name: string) => {
        cronJobs.delete(name);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.retentionEnabled') return true;
              if (key === 'app.cron.retentionSchedule') return '0 4 * * 0';
              return defaultValue;
            }),
          },
        },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: CronLockService,
          useValue: {
            runExclusive: jest.fn(
              async (_name: string, fn: () => Promise<void>) => {
                await fn();
                return { ran: true };
              },
            ),
          },
        },
        { provide: DataRetentionService, useValue: retentionService },
      ],
    }).compile();

    service = moduleRef.get(DataRetentionCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleRetentionCron', () => {
    it('runs the retention job under lock', async () => {
      retentionService.runRetentionJob.mockResolvedValue({
        auditLogsPurged: 1,
        softDeletedPurged: 2,
        oldNotificationsPurged: 3,
      });

      await service.handleRetentionCron();

      expect(retentionService.runRetentionJob).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the retention cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        RETENTION_CRON_NAME,
        expect.objectContaining({}),
      );
    });

    it('skips registration when retention cron is disabled', async () => {
      const addCronJob = jest.fn();
      const moduleRef = await Test.createTestingModule({
        providers: [
          DataRetentionCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'app.cron.enabled') return true;
                if (key === 'app.cron.retentionEnabled') return false;
                return undefined;
              }),
            },
          },
          { provide: SchedulerRegistry, useValue: { addCronJob } },
          { provide: CronLockService, useValue: { runExclusive: jest.fn() } },
          { provide: DataRetentionService, useValue: retentionService },
        ],
      }).compile();

      moduleRef.get(DataRetentionCronService).onModuleInit();
      expect(addCronJob).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('stops and removes the cron job', () => {
      const stop = jest.fn();
      cronJobs.set(RETENTION_CRON_NAME, { stop });
      schedulerRegistry.doesExist.mockReturnValue(true);
      schedulerRegistry.getCronJob.mockReturnValue({ stop });

      service.onModuleDestroy();

      expect(stop).toHaveBeenCalled();
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        RETENTION_CRON_NAME,
      );
    });
  });
});
