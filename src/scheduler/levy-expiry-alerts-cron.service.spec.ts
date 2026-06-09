import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { LevyExpiryAlertService } from '../levy-exchange/services/levy-expiry-alert.service.js';

import { CronLockService } from './cron-lock.service.js';
import { LevyExpiryAlertsCronService } from './levy-expiry-alerts-cron.service.js';
import { LEVY_EXPIRY_ALERTS_CRON_NAME } from './scheduler.constants.js';

describe('LevyExpiryAlertsCronService', () => {
  let service: LevyExpiryAlertsCronService;
  let alertService: jest.Mocked<Pick<LevyExpiryAlertService, 'sendDueAlerts'>>;
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    alertService = { sendDueAlerts: jest.fn().mockResolvedValue(2) };
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
        LevyExpiryAlertsCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.levyExpiryAlertsEnabled') return true;
              if (key === 'app.cron.levyExpiryAlertsSchedule')
                return '0 8 * * *';
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
        { provide: LevyExpiryAlertService, useValue: alertService },
      ],
    }).compile();

    service = moduleRef.get(LevyExpiryAlertsCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleLevyExpiryAlertsCron', () => {
    it('sends due levy expiry alerts under lock', async () => {
      await service.handleLevyExpiryAlertsCron();

      expect(alertService.sendDueAlerts).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the levy expiry alerts cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        LEVY_EXPIRY_ALERTS_CRON_NAME,
        expect.objectContaining({}),
      );
    });
  });
});
