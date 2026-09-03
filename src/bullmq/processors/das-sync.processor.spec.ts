import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';

import { DasFundingSyncService } from '../../das/das-funding-sync.service.js';
import {
  DAS_JOB_SYNC_FUNDING_PAYMENTS,
  DAS_JOB_SYNC_ORGANISATION,
} from '../../das/das-job.constants.js';
import { DasLevySyncService } from '../../das/das-levy-sync.service.js';
import { QUEUE_DAS_SYNC_DLQ } from '../bullmq.constants.js';

import { DasSyncProcessor } from './das-sync.processor.js';

describe('DasSyncProcessor', () => {
  let processor: DasSyncProcessor;
  const syncOrganisation = jest.fn();
  const syncFundingPayments = jest.fn();
  const dlqAdd = jest.fn();

  /**
   * Which DAS mode the processor is running in. `isDasManualMode` reads
   * `app.das.baseUrl`, so setting it here is the same switch production uses.
   */
  let dasBaseUrl = 'https://das.example.com';

  beforeEach(async () => {
    dasBaseUrl = 'https://das.example.com';
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasSyncProcessor,
        {
          provide: DasLevySyncService,
          useValue: { syncOrganisation },
        },
        {
          provide: DasFundingSyncService,
          useValue: { syncOrganisation: syncFundingPayments },
        },
        {
          provide: getQueueToken(QUEUE_DAS_SYNC_DLQ),
          useValue: { add: dlqAdd },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback?: unknown) => dasBaseUrl ?? fallback,
          },
        },
      ],
    }).compile();

    processor = moduleRef.get(DasSyncProcessor);
    jest.clearAllMocks();
  });

  it('processes organisation sync job', async () => {
    const job = {
      id: 'job-1',
      name: DAS_JOB_SYNC_ORGANISATION,
      data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
    } as Job<{ organisationId: string; requestedByUserId?: string }>;

    await processor.process(job);
    expect(syncOrganisation).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('processes funding payments sync job', async () => {
    const job = {
      id: 'job-funding',
      name: DAS_JOB_SYNC_FUNDING_PAYMENTS,
      data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
    } as Job<{ organisationId: string; requestedByUserId?: string }>;

    await processor.process(job);
    expect(syncFundingPayments).toHaveBeenCalledWith('org-1', 'user-1');
    expect(syncOrganisation).not.toHaveBeenCalled();
  });

  it('publishes terminal failures to DAS DLQ', async () => {
    syncOrganisation.mockRejectedValueOnce(new Error('boom'));
    const job = {
      id: 'job-2',
      name: DAS_JOB_SYNC_ORGANISATION,
      data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as unknown as Job<{ organisationId: string; requestedByUserId?: string }>;

    await expect(processor.process(job)).rejects.toThrow('boom');
    expect(dlqAdd).toHaveBeenCalledTimes(1);
  });
  /**
   * The queue path, not the controller.
   *
   * `POST /das/sync` returns 409 in manual mode, but the nightly crons never
   * touch the controller: `das-sync-cron.service.ts` and
   * `das-funding-sync-cron.service.ts` both call
   * `DasSyncDispatchService.enqueue*`, which puts a job straight on this queue.
   * These tests cover the path that actually runs unattended.
   */
  describe('manual mode', () => {
    beforeEach(() => {
      dasBaseUrl = '';
    });

    it('skips an organisation sync rather than calling the client', async () => {
      const job = {
        id: 'job-manual-1',
        name: DAS_JOB_SYNC_ORGANISATION,
        data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
      } as Job<{ organisationId: string; requestedByUserId?: string }>;

      await processor.process(job);

      // Calling through would let das-levy-sync stamp lastSyncStatus = SUCCESS
      // over a figure somebody typed.
      expect(syncOrganisation).not.toHaveBeenCalled();
    });

    it('skips a funding payments sync', async () => {
      const job = {
        id: 'job-manual-2',
        name: DAS_JOB_SYNC_FUNDING_PAYMENTS,
        data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
      } as Job<{ organisationId: string; requestedByUserId?: string }>;

      await processor.process(job);

      expect(syncFundingPayments).not.toHaveBeenCalled();
    });

    it('resolves instead of throwing, so the DLQ stays empty', async () => {
      const job = {
        id: 'job-manual-3',
        name: DAS_JOB_SYNC_ORGANISATION,
        data: { organisationId: 'org-1' },
      } as Job<{ organisationId: string; requestedByUserId?: string }>;

      await expect(processor.process(job)).resolves.toBeUndefined();

      // The reason this is a skip and not a throw: a nightly cron across every
      // organisation would otherwise fill QUEUE_DAS_SYNC_DLQ with jobs that
      // were refused correctly, turning an expected state into an alert.
      expect(dlqAdd).not.toHaveBeenCalled();
    });

    it('whitespace in DAS_BASE_URL still counts as manual', async () => {
      dasBaseUrl = '   ';
      const job = {
        id: 'job-manual-4',
        name: DAS_JOB_SYNC_ORGANISATION,
        data: { organisationId: 'org-1' },
      } as Job<{ organisationId: string; requestedByUserId?: string }>;

      await processor.process(job);

      expect(syncOrganisation).not.toHaveBeenCalled();
    });

    it('still syncs when DAS is configured', async () => {
      dasBaseUrl = 'https://das.example.com';
      const job = {
        id: 'job-live',
        name: DAS_JOB_SYNC_ORGANISATION,
        data: { organisationId: 'org-1', requestedByUserId: 'user-1' },
      } as Job<{ organisationId: string; requestedByUserId?: string }>;

      await processor.process(job);

      expect(syncOrganisation).toHaveBeenCalledWith('org-1', 'user-1');
    });
  });
});
