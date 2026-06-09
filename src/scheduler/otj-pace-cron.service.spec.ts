import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { OtjPaceService } from '../otj/otj-pace.service.js';

import { CronLockService } from './cron-lock.service.js';
import { OtjPaceCronService } from './otj-pace-cron.service.js';
import { OTJ_PACE_CRON_NAME } from './scheduler.constants.js';

describe('OtjPaceCronService', () => {
  let service: OtjPaceCronService;
  let paceService: jest.Mocked<
    Pick<OtjPaceService, 'flagPaceForAllActiveEnrolments'>
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
    paceService = {
      flagPaceForAllActiveEnrolments: jest.fn().mockResolvedValue(5),
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
        OtjPaceCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.otjPaceEnabled') return true;
              if (key === 'app.cron.otjPaceSchedule') return '0 1 * * *';
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
        { provide: OtjPaceService, useValue: paceService },
      ],
    }).compile();

    service = moduleRef.get(OtjPaceCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleOtjPaceCron', () => {
    it('flags OTJ pace for active enrolments under lock', async () => {
      await service.handleOtjPaceCron();

      expect(paceService.flagPaceForAllActiveEnrolments).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the OTJ pace cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        OTJ_PACE_CRON_NAME,
        expect.objectContaining({}),
      );
    });
  });
});
