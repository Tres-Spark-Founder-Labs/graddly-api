import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasSyncDispatchService } from '../das/das-sync-dispatch.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { CronLockService } from './cron-lock.service.js';
import { DasFundingSyncCronService } from './das-funding-sync-cron.service.js';
import { DAS_FUNDING_SYNC_CRON_NAME } from './scheduler.constants.js';

describe('DasFundingSyncCronService', () => {
  let service: DasFundingSyncCronService;
  let dispatch: jest.Mocked<Pick<DasSyncDispatchService, 'enqueueFundingSync'>>;
  let organisationsRepo: { find: jest.Mock };
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    dispatch = {
      enqueueFundingSync: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
    };
    organisationsRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]),
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
        DasFundingSyncCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.dasFundingSyncEnabled') return true;
              if (key === 'app.cron.dasFundingSyncSchedule') return '0 2 * * *';
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
        { provide: DasSyncDispatchService, useValue: dispatch },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationsRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(DasFundingSyncCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('enqueues funding sync jobs for organisations with UKPRN', async () => {
    await service.handleFundingSyncCron();

    expect(organisationsRepo.find).toHaveBeenCalled();
    expect(dispatch.enqueueFundingSync).toHaveBeenCalledTimes(2);
    expect(dispatch.enqueueFundingSync).toHaveBeenCalledWith({
      organisationId: 'org-1',
      requestedByUserId: 'system-das-funding-sync',
    });
  });

  it('registers the funding sync cron when enabled', () => {
    service.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
      DAS_FUNDING_SYNC_CRON_NAME,
      expect.objectContaining({}),
    );
  });
});
