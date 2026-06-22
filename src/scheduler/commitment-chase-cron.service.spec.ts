import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { CommitmentChaseService } from '../commitments/commitment-chase.service.js';

import { CommitmentChaseCronService } from './commitment-chase-cron.service.js';
import { CronLockService } from './cron-lock.service.js';
import { COMMITMENT_CHASE_CRON_NAME } from './scheduler.constants.js';

describe('CommitmentChaseCronService', () => {
  let service: CommitmentChaseCronService;
  let chaseService: { sendDueChases: jest.Mock };
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    chaseService = { sendDueChases: jest.fn().mockResolvedValue(2) };
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
