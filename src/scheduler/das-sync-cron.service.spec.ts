import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasSyncDispatchService } from '../das/das-sync-dispatch.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { CronLockService } from './cron-lock.service.js';
import { DasSyncCronService } from './das-sync-cron.service.js';
import { DAS_SYNC_CRON_NAME } from './scheduler.constants.js';
import {
  createSchedulerRegistryDouble,
  type SchedulerRegistryDouble,
} from './testing/scheduler-registry.double.js';

describe('DasSyncCronService', () => {
  let service: DasSyncCronService;
  let dispatch: jest.Mocked<Pick<DasSyncDispatchService, 'enqueueSync'>>;
  let organisationsRepo: { find: jest.Mock };
  let schedulerRegistry: SchedulerRegistryDouble['registry'];
  let cronJobs: SchedulerRegistryDouble['jobs'];

  beforeEach(async () => {
    dispatch = { enqueueSync: jest.fn().mockResolvedValue({ jobId: 'job-1' }) };
    organisationsRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]),
    };
    ({ registry: schedulerRegistry, jobs: cronJobs } =
      createSchedulerRegistryDouble());

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DasSyncCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.dasSyncEnabled') return true;
              if (key === 'app.cron.dasSyncSchedule') return '*/15 * * * *';
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

    service = moduleRef.get(DasSyncCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleDasSyncCron', () => {
    it('enqueues sync jobs for organisations with UKPRN', async () => {
      await service.handleDasSyncCron();

      expect(organisationsRepo.find).toHaveBeenCalled();
      expect(dispatch.enqueueSync).toHaveBeenCalledTimes(2);
      expect(dispatch.enqueueSync).toHaveBeenCalledWith({
        organisationId: 'org-1',
      });
    });
  });

  describe('onModuleInit', () => {
    it('registers the DAS sync cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        DAS_SYNC_CRON_NAME,
        expect.objectContaining({}),
      );
    });

    it('skips registration when DAS sync is disabled', async () => {
      const addCronJob = jest.fn();
      const moduleRef = await Test.createTestingModule({
        providers: [
          DasSyncCronService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'app.cron.enabled') return true;
                if (key === 'app.cron.dasSyncEnabled') return false;
                return undefined;
              }),
            },
          },
          { provide: SchedulerRegistry, useValue: { addCronJob } },
          { provide: CronLockService, useValue: { runExclusive: jest.fn() } },
          { provide: DasSyncDispatchService, useValue: dispatch },
          {
            provide: getRepositoryToken(Organisation),
            useValue: organisationsRepo,
          },
        ],
      }).compile();

      moduleRef.get(DasSyncCronService).onModuleInit();
      expect(addCronJob).not.toHaveBeenCalled();
    });
  });
});
