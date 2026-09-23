import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { getRlsBootstrap } from '../common/context/correlation-id-context.js';
import { DigestDispatchService } from '../notifications/digest-dispatch.service.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';

import { CronLockService } from './cron-lock.service.js';
import { DigestCronService } from './digest-cron.service.js';
import { DIGEST_CRON_NAME } from './scheduler.constants.js';
import {
  createSchedulerRegistryDouble,
  type SchedulerRegistryDouble,
} from './testing/scheduler-registry.double.js';

describe('DigestCronService', () => {
  let service: DigestCronService;
  let digestDispatch: { enqueueWeeklyOtjDigest: jest.Mock };
  let otjLogRepo: { createQueryBuilder: jest.Mock };
  /** `getRlsBootstrap()` as observed from inside each call. */
  let observed: { read?: boolean; enqueue: boolean[] };
  let schedulerRegistry: SchedulerRegistryDouble['registry'];
  let cronJobs: SchedulerRegistryDouble['jobs'];

  beforeEach(async () => {
    observed = { enqueue: [] };
    digestDispatch = {
      enqueueWeeklyOtjDigest: jest.fn(() => {
        observed.enqueue.push(getRlsBootstrap());
        return Promise.resolve(undefined);
      }),
    };
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => {
        observed.read = getRlsBootstrap();
        return Promise.resolve([
          { organisationId: 'org-1' },
          { organisationId: 'org-2' },
        ]);
      }),
    };
    otjLogRepo = { createQueryBuilder: jest.fn(() => qb) };
    ({ registry: schedulerRegistry, jobs: cronJobs } =
      createSchedulerRegistryDouble());

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
        { provide: DigestDispatchService, useValue: digestDispatch },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjLogRepo },
      ],
    }).compile();

    service = moduleRef.get(DigestCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('enqueues digest jobs for orgs with pending OTJ entries', async () => {
    await service.handleDigestCron();

    expect(digestDispatch.enqueueWeeklyOtjDigest).toHaveBeenCalledTimes(2);
    expect(digestDispatch.enqueueWeeklyOtjDigest).toHaveBeenCalledWith({
      organisationId: 'org-1',
    });
  });

  it('reads the organisations under the bootstrap window, and queues each job outside it', async () => {
    // The cron has no organisation; without the window the read returned
    // nothing and no digest was ever queued.
    await service.handleDigestCron();

    expect(observed.read).toBe(true);
    expect(observed.enqueue).toEqual([false, false]);
  });

  it('registers the digest cron when enabled', () => {
    service.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
      DIGEST_CRON_NAME,
      expect.objectContaining({}),
    );
  });
});
