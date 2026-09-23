import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisHealthIndicator } from '../health/redis-health.indicator.js';

import { CronLockService } from './cron-lock.service.js';
import { HealthCronService } from './health-cron.service.js';
import { HEALTH_CHECK_CRON_NAME } from './scheduler.constants.js';
import {
  createSchedulerRegistryDouble,
  type SchedulerRegistryDouble,
} from './testing/scheduler-registry.double.js';

describe('HealthCronService', () => {
  let service: HealthCronService;
  let healthCheck: jest.Mocked<Pick<HealthCheckService, 'check'>>;
  let schedulerRegistry: SchedulerRegistryDouble['registry'];
  let cronJobs: SchedulerRegistryDouble['jobs'];

  beforeEach(async () => {
    healthCheck = {
      check: jest.fn(),
    };

    ({ registry: schedulerRegistry, jobs: cronJobs } =
      createSchedulerRegistryDouble());

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') {
                return true;
              }
              if (key === 'app.cron.healthSchedule') {
                return '*/5 * * * *';
              }
              return defaultValue;
            }),
          },
        },
        { provide: HealthCheckService, useValue: healthCheck },
        {
          provide: TypeOrmHealthIndicator,
          useValue: { pingCheck: jest.fn() },
        },
        {
          provide: RedisHealthIndicator,
          useValue: { isHealthy: jest.fn() },
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
      ],
    }).compile();

    service = moduleRef.get(HealthCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('runHealthCheck', () => {
    it('runs database and redis checks', async () => {
      healthCheck.check.mockResolvedValue({
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
      });

      const result = await service.runHealthCheck();

      expect(result.status).toBe('ok');
      expect(healthCheck.check).toHaveBeenCalledTimes(1);
    });

    it('propagates health check failures', async () => {
      healthCheck.check.mockRejectedValue(new Error('database down'));

      await expect(service.runHealthCheck()).rejects.toThrow('database down');
    });
  });

  describe('handleHealthCheckCron', () => {
    it('logs success without throwing', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      healthCheck.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
      });

      await expect(service.handleHealthCheckCron()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled health check OK'),
      );

      logSpy.mockRestore();
    });

    it('logs errors without throwing', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      healthCheck.check.mockRejectedValue(new Error('redis down'));

      await expect(service.handleHealthCheckCron()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled health check failed'),
      );

      errorSpy.mockRestore();
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
          HealthCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: unknown) => {
                if (key === 'app.cron.enabled') {
                  return true;
                }
                return defaultValue;
              }),
            },
          },
          { provide: HealthCheckService, useValue: healthCheck },
          {
            provide: TypeOrmHealthIndicator,
            useValue: { pingCheck: jest.fn() },
          },
          {
            provide: RedisHealthIndicator,
            useValue: { isHealthy: jest.fn() },
          },
          { provide: SchedulerRegistry, useValue: schedulerRegistry },
          { provide: CronLockService, useValue: { runExclusive } },
        ],
      }).compile();

      const lockedService = moduleRef.get(HealthCronService);
      healthCheck.check.mockResolvedValue({
        status: 'ok',
        info: {},
        error: {},
        details: { database: { status: 'up' }, redis: { status: 'up' } },
      });

      await lockedService.handleHealthCheckCron();

      expect(runExclusive).toHaveBeenCalledWith(
        HEALTH_CHECK_CRON_NAME,
        expect.any(Function),
      );
    });
  });

  describe('onModuleInit', () => {
    it('registers the health-check cron job when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        HEALTH_CHECK_CRON_NAME,
        expect.objectContaining({}),
      );
    });

    it('skips registration when cron is disabled', async () => {
      const addCronJob = jest.fn();

      const moduleRef = await Test.createTestingModule({
        providers: [
          HealthCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'app.cron.enabled') {
                  return false;
                }
                return undefined;
              }),
            },
          },
          { provide: HealthCheckService, useValue: healthCheck },
          {
            provide: TypeOrmHealthIndicator,
            useValue: { pingCheck: jest.fn() },
          },
          {
            provide: RedisHealthIndicator,
            useValue: { isHealthy: jest.fn() },
          },
          {
            provide: SchedulerRegistry,
            useValue: { addCronJob },
          },
          {
            provide: CronLockService,
            useValue: { runExclusive: jest.fn() },
          },
        ],
      }).compile();

      const disabledService = moduleRef.get(HealthCronService);
      disabledService.onModuleInit();

      expect(addCronJob).not.toHaveBeenCalled();
    });
  });
});
