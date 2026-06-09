import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CronLockService } from './cron-lock.service.js';
import { DigestCronService } from './digest-cron.service.js';
import { DIGEST_CRON_NAME } from './scheduler.constants.js';

describe('DigestCronService', () => {
  let service: DigestCronService;
  let cronLock: { runExclusive: jest.Mock };
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<
    string,
    { stop: jest.Mock; fireOnTick?: () => void }
  >();

  beforeEach(async () => {
    cronJobs.clear();
    cronLock = {
      runExclusive: jest.fn(async (_name: string, fn: () => Promise<void>) => {
        await fn();
        return { ran: true };
      }),
    };
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
        DigestCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.digestEnabled') return true;
              if (key === 'app.cron.digestSchedule') return '0 8 * * 1';
              return defaultValue;
            }),
          },
        },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: CronLockService, useValue: cronLock },
      ],
    }).compile();

    service = moduleRef.get(DigestCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleDigestCron', () => {
    it('logs the skeleton tick without throwing', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await expect(service.handleDigestCron()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Digest cron tick (skeleton)'),
      );

      logSpy.mockRestore();
    });

    it('delegates to CronLockService.runExclusive', async () => {
      const runExclusive = jest.fn(
        async (_name: string, fn: () => Promise<void>) => {
          await fn();
          return { ran: true };
        },
      );
      const moduleRef = await Test.createTestingModule({
        providers: [
          DigestCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === 'app.cron.enabled') return true;
                if (key === 'app.cron.digestEnabled') return true;
                return defaultValue;
              }),
            },
          },
          { provide: SchedulerRegistry, useValue: schedulerRegistry },
          { provide: CronLockService, useValue: { runExclusive } },
        ],
      }).compile();

      const lockedService = moduleRef.get(DigestCronService);
      await lockedService.handleDigestCron();

      expect(runExclusive).toHaveBeenCalledWith(
        DIGEST_CRON_NAME,
        expect.any(Function),
      );
    });

    it('propagates lock failures', async () => {
      cronLock.runExclusive.mockRejectedValueOnce(new Error('lock busy'));

      await expect(service.handleDigestCron()).rejects.toThrow('lock busy');
    });
  });

  describe('onModuleInit', () => {
    it('registers the digest cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        DIGEST_CRON_NAME,
        expect.objectContaining({}),
      );
    });

    it('skips registration when digest cron is disabled', async () => {
      const addCronJob = jest.fn();
      const moduleRef = await Test.createTestingModule({
        providers: [
          DigestCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'app.cron.enabled') return true;
                if (key === 'app.cron.digestEnabled') return false;
                return undefined;
              }),
            },
          },
          { provide: SchedulerRegistry, useValue: { addCronJob } },
          { provide: CronLockService, useValue: cronLock },
        ],
      }).compile();

      moduleRef.get(DigestCronService).onModuleInit();
      expect(addCronJob).not.toHaveBeenCalled();
    });

    it('skips registration when global cron is disabled', async () => {
      const addCronJob = jest.fn();
      const moduleRef = await Test.createTestingModule({
        providers: [
          DigestCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'app.cron.enabled') return false;
                return undefined;
              }),
            },
          },
          { provide: SchedulerRegistry, useValue: { addCronJob } },
          { provide: CronLockService, useValue: cronLock },
        ],
      }).compile();

      moduleRef.get(DigestCronService).onModuleInit();
      expect(addCronJob).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('stops and removes the cron job', () => {
      const stop = jest.fn();
      cronJobs.set(DIGEST_CRON_NAME, { stop });
      schedulerRegistry.doesExist.mockReturnValue(true);
      schedulerRegistry.getCronJob.mockReturnValue({ stop });

      service.onModuleDestroy();

      expect(stop).toHaveBeenCalled();
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        DIGEST_CRON_NAME,
      );
    });
  });
});
