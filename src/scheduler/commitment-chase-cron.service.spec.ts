import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CommitmentChaseService } from '../commitments/commitment-chase.service.js';

import { CommitmentChaseCronService } from './commitment-chase-cron.service.js';
import { CronLockService } from './cron-lock.service.js';
import { COMMITMENT_CHASE_CRON_NAME } from './scheduler.constants.js';
import {
  createSchedulerRegistryDouble,
  type SchedulerRegistryDouble,
} from './testing/scheduler-registry.double.js';

describe('CommitmentChaseCronService', () => {
  let service: CommitmentChaseCronService;
  let chaseService: { sendDueChases: jest.Mock };
  let schedulerRegistry: SchedulerRegistryDouble['registry'];
  let cronJobs: SchedulerRegistryDouble['jobs'];

  beforeEach(async () => {
    chaseService = { sendDueChases: jest.fn().mockResolvedValue(2) };
    ({ registry: schedulerRegistry, jobs: cronJobs } =
      createSchedulerRegistryDouble());

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CommitmentChaseCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.commitmentChaseEnabled') return true;
              if (key === 'app.cron.commitmentChaseSchedule')
                return '0 6 * * *';
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
        { provide: CommitmentChaseService, useValue: chaseService },
      ],
    }).compile();

    service = moduleRef.get(CommitmentChaseCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('delegates to CommitmentChaseService', async () => {
    await service.handleCommitmentChaseCron();
    expect(chaseService.sendDueChases).toHaveBeenCalled();
  });

  it('registers cron when enabled', () => {
    service.onModuleInit();
    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
      COMMITMENT_CHASE_CRON_NAME,
      expect.objectContaining({}),
    );
  });
});
