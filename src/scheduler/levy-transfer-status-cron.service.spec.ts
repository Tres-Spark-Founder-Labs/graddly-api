import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferService } from '../levy-exchange/services/levy-transfer.service.js';

import { CronLockService } from './cron-lock.service.js';
import { LevyTransferStatusCronService } from './levy-transfer-status-cron.service.js';
import { LEVY_TRANSFER_STATUS_CRON_NAME } from './scheduler.constants.js';

describe('LevyTransferStatusCronService', () => {
  let service: LevyTransferStatusCronService;
  let transferService: jest.Mocked<
    Pick<LevyTransferService, 'syncTransferStatusFromDas'>
  >;
  let transferRepo: { find: jest.Mock };
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    transferService = {
      syncTransferStatusFromDas: jest.fn().mockResolvedValue(undefined),
    };
    transferRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'xfer-1', esfaTransferReference: 'ESFA-1' },
        { id: 'xfer-2', esfaTransferReference: null },
      ]),
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
        LevyTransferStatusCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.levyTransferStatusEnabled') return true;
              if (key === 'app.cron.levyTransferStatusSchedule')
                return '0 3 * * *';
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
        { provide: LevyTransferService, useValue: transferService },
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: transferRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(LevyTransferStatusCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleLevyTransferStatusCron', () => {
    it('syncs DAS status for transfers with ESFA references', async () => {
      await service.handleLevyTransferStatusCron();

      expect(transferRepo.find).toHaveBeenCalled();
      expect(transferService.syncTransferStatusFromDas).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe('onModuleInit', () => {
    it('registers the levy transfer status cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        LEVY_TRANSFER_STATUS_CRON_NAME,
        expect.objectContaining({}),
      );
    });
  });
});
