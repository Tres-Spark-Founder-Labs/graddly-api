import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  DAS_SYNC_STALE_AFTER_HOURS,
  DAS_SYNC_STATUS_WINDOW_HOURS,
  DasSyncStatusService,
} from './das-sync-status.service.js';
import { DasApiActivity } from './entities/das-api-activity.entity.js';
import { DasSyncHealth } from './enums/das-sync-health.enum.js';

/**
 * F2.3.1 AC5. The band is the whole feature: a provider reads one colour and
 * decides whether to act. These tests pin the cases where the obvious
 * implementation gets it wrong.
 */
describe('DasSyncStatusService', () => {
  const repo = { findOne: jest.fn(), count: jest.fn() };
  let service: DasSyncStatusService;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  const activity = (over: Partial<DasApiActivity> = {}) =>
    ({
      id: 'act-1',
      succeeded: true,
      createdAt: hoursAgo(1),
      errorMessage: null,
      ...over,
    }) as DasApiActivity;

  beforeEach(async () => {
    jest.clearAllMocks();
    repo.count.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DasSyncStatusService,
        { provide: getRepositoryToken(DasApiActivity), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(DasSyncStatusService);
  });

  /**
   * findOne is called three times in a fixed order: last success, last
   * attempt, last failure.
   */
  const stub = ({
    lastSuccess,
    lastAttempt,
    lastFailure = null,
  }: {
    lastSuccess: DasApiActivity | null;
    lastAttempt: DasApiActivity | null;
    lastFailure?: DasApiActivity | null;
  }) => {
    repo.findOne
      .mockResolvedValueOnce(lastSuccess)
      .mockResolvedValueOnce(lastAttempt)
      .mockResolvedValueOnce(lastFailure);
  };

  it('is green when the last attempt succeeded recently with no errors', async () => {
    const recent = activity();
    stub({ lastSuccess: recent, lastAttempt: recent });

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.GREEN);
    expect(status.errorCount).toBe(0);
    expect(status.lastSyncAt).toBe(recent.createdAt.toISOString());
    expect(status.windowHours).toBe(DAS_SYNC_STATUS_WINDOW_HOURS);
  });

  /**
   * The case the obvious implementation gets wrong. Zero errors reads as
   * healthy, but a provider whose DAS integration has never once worked is in
   * the worst state this indicator can describe.
   */
  it('is red when nothing has ever synced, despite zero errors', async () => {
    stub({ lastSuccess: null, lastAttempt: null });

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.RED);
    expect(status.errorCount).toBe(0);
    expect(status.lastSyncAt).toBeNull();
  });

  it('is red when the most recent attempt failed, whatever the history', async () => {
    stub({
      lastSuccess: activity({ createdAt: hoursAgo(3) }),
      lastAttempt: activity({ succeeded: false, createdAt: hoursAgo(1) }),
      lastFailure: activity({
        succeeded: false,
        errorMessage: 'ESFA returned 503',
      }),
    });

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.RED);
    expect(status.lastErrorMessage).toBe('ESFA returned 503');
  });

  it('is amber when succeeding but with failures inside the window', async () => {
    const recent = activity();
    stub({ lastSuccess: recent, lastAttempt: recent });
    repo.count.mockResolvedValue(4);

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.AMBER);
    expect(status.errorCount).toBe(4);
  });

  it('is amber when the last success is stale, even with no errors', async () => {
    const stale = activity({
      createdAt: hoursAgo(DAS_SYNC_STALE_AFTER_HOURS + 5),
    });
    stub({ lastSuccess: stale, lastAttempt: stale });

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.AMBER);
  });

  it('stays green just inside the staleness threshold', async () => {
    const recent = activity({
      createdAt: hoursAgo(DAS_SYNC_STALE_AFTER_HOURS - 1),
    });
    stub({ lastSuccess: recent, lastAttempt: recent });

    const status = await service.getStatus('org-1');

    expect(status.health).toBe(DasSyncHealth.GREEN);
  });
});
