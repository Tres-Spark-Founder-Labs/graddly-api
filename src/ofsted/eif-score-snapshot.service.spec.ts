import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { setRlsBootstrap } from '../common/context/correlation-id-context.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { EifScoreSnapshotService } from './eif-score-snapshot.service.js';
import { EifScoreSnapshot } from './entities/eif-score-snapshot.entity.js';
import { EifRag } from './enums/eif-rag.enum.js';

jest.mock('../common/context/correlation-id-context.js', () => ({
  getRlsBootstrap: jest.fn(() => false),
  setRlsBootstrap: jest.fn(),
}));

const NOW = new Date('2026-08-01T02:00:00Z');

describe('EifScoreSnapshotService (F2.1.1)', () => {
  const snapshotRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v: unknown) => v),
  };
  const organisationRepo = { find: jest.fn() };
  const calculator = { calculate: jest.fn() };

  let service: EifScoreSnapshotService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EifScoreSnapshotService,
        {
          provide: getRepositoryToken(EifScoreSnapshot),
          useValue: snapshotRepo,
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: EifScoreCalculatorService, useValue: calculator },
      ],
    }).compile();

    service = moduleRef.get(EifScoreSnapshotService);
    jest.clearAllMocks();
    snapshotRepo.findOne.mockResolvedValue(null);
    snapshotRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    snapshotRepo.find.mockResolvedValue([]);
    organisationRepo.find.mockResolvedValue([]);
    calculator.calculate.mockResolvedValue({
      overallPercent: 82,
      alertBanner: false,
      calculatedAt: NOW.toISOString(),
      criteria: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          percent: 90,
          rag: EifRag.GREEN,
        },
      ],
    });
  });

  it('stores the day, the overall score and every criterion', async () => {
    await service.captureForOrganisation('org-1', NOW);

    const saved = snapshotRepo.save.mock.calls as [Record<string, unknown>][];
    expect(saved[0][0]).toMatchObject({
      organisationId: 'org-1',
      capturedOn: '2026-08-01',
      overallPercent: 82,
      overallRag: EifRag.GREEN,
      criteria: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          percent: 90,
          rag: EifRag.GREEN,
        },
      ],
    });
  });

  /**
   * The cron can be retried by the scheduler or run by hand during an
   * incident. Two points on the same day of a compliance chart is the kind of
   * thing an inspector asks about.
   */
  it('replaces the existing row for a day rather than adding a second', async () => {
    const existing = { id: 's-1', overallPercent: 40 };
    snapshotRepo.findOne.mockResolvedValue(existing);

    await service.captureForOrganisation('org-1', NOW);

    expect(snapshotRepo.create).not.toHaveBeenCalled();
    expect(existing.overallPercent).toBe(82);
    expect(snapshotRepo.save).toHaveBeenCalledWith(existing);
  });

  /**
   * The whole reason this service exists in the shape it does. The cron has
   * no signed-in user and no active organisation, so every table the
   * calculator reads is invisible without the flag — and the failure would be
   * a recorded 0% for every provider, every night, rather than an error.
   */
  it('captures under the RLS bootstrap flag and restores it', async () => {
    await service.captureForOrganisation('org-1', NOW);

    expect(setRlsBootstrap).toHaveBeenNthCalledWith(1, true);
    expect(setRlsBootstrap).toHaveBeenLastCalledWith(false);
  });

  it('restores the flag even when the calculator throws', async () => {
    calculator.calculate.mockRejectedValue(new Error('boom'));

    await expect(service.captureForOrganisation('org-1', NOW)).rejects.toThrow(
      'boom',
    );
    expect(setRlsBootstrap).toHaveBeenLastCalledWith(false);
  });

  describe('captureAll', () => {
    it('captures each provider organisation', async () => {
      organisationRepo.find.mockResolvedValue([
        { id: 'org-1' },
        { id: 'org-2' },
      ]);

      await expect(service.captureAll(NOW)).resolves.toBe(2);
      expect(calculator.calculate).toHaveBeenCalledTimes(2);
    });

    /** One provider's bad data must not cost every other provider a day. */
    it('continues past an organisation that fails', async () => {
      organisationRepo.find.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
      calculator.calculate
        .mockRejectedValueOnce(new Error('malformed'))
        .mockResolvedValueOnce({
          overallPercent: 70,
          alertBanner: false,
          calculatedAt: NOW.toISOString(),
          criteria: [],
        });

      await expect(service.captureAll(NOW)).resolves.toBe(1);
      expect(setRlsBootstrap).toHaveBeenLastCalledWith(false);
    });
  });

  describe('listTrend', () => {
    it('asks for the last twelve months, oldest first', async () => {
      await service.listTrend('org-1', NOW);

      const calls = snapshotRepo.find.mock.calls as [
        {
          where: { capturedOn: { _value: string[] } };
          order: Record<string, string>;
        },
      ][];
      expect(calls[0][0].where.capturedOn._value).toEqual([
        '2025-08-01',
        '2026-08-01',
      ]);
      expect(calls[0][0].order).toEqual({ capturedOn: 'ASC' });
    });

    /**
     * Returns whatever exists rather than inventing points. On the day this
     * ships that is nothing at all, and the caller has to say so rather than
     * draw a line through one point.
     */
    it('returns an empty list when nothing has been captured yet', async () => {
      await expect(service.listTrend('org-1', NOW)).resolves.toEqual([]);
    });
  });

  describe('getTrend (F2.1.1 AC5)', () => {
    const snapshotOn = (
      capturedOn: string,
      safeguarding: number,
      overall: number,
    ) => ({
      capturedOn,
      overallPercent: overall,
      overallRag: EifRag.GREEN,
      criteria: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          percent: safeguarding,
          rag: EifRag.GREEN,
        },
      ],
    });

    it('builds one series per criterion, oldest first', async () => {
      snapshotRepo.find.mockResolvedValue([
        snapshotOn('2026-07-01', 70, 72),
        snapshotOn('2026-07-02', 80, 78),
      ]);

      const trend = await service.getTrend('org-1', NOW);

      const safeguarding = trend.criteria.find(
        (c) => c.slug === 'safeguarding',
      );
      expect(safeguarding?.points).toEqual([
        { capturedOn: '2026-07-01', percent: 70, rag: EifRag.GREEN },
        { capturedOn: '2026-07-02', percent: 80, rag: EifRag.GREEN },
      ]);
      expect(trend.overall).toHaveLength(2);
      expect(trend.pointCount).toBe(2);
      expect(trend.earliestCapturedOn).toBe('2026-07-01');
      expect(trend.windowMonths).toBe(12);
    });

    /**
     * Series come from the criteria catalogue, not from whatever the
     * snapshots happen to contain, so all seven criteria appear in the hub's
     * order even before any of them has been captured.
     */
    it('returns every catalogue criterion even with no snapshots', async () => {
      snapshotRepo.find.mockResolvedValue([]);

      const trend = await service.getTrend('org-1', NOW);

      expect(trend.criteria).toHaveLength(7);
      expect(trend.criteria.every((c) => c.points.length === 0)).toBe(true);
    });

    /**
     * One reading is a fact, not a trend. Drawing it as a line reads as
     * "flat" rather than "we have only just started recording" — the same
     * distinction F1.4.1 AC3 had to make.
     */
    it('reports no trend data from a single capture', async () => {
      snapshotRepo.find.mockResolvedValue([snapshotOn('2026-07-01', 70, 72)]);

      const trend = await service.getTrend('org-1', NOW);

      expect(trend.pointCount).toBe(1);
      expect(trend.hasTrendData).toBe(false);
    });

    it('reports trend data once two days exist', async () => {
      snapshotRepo.find.mockResolvedValue([
        snapshotOn('2026-07-01', 70, 72),
        snapshotOn('2026-07-02', 80, 78),
      ]);

      await expect(
        service.getTrend('org-1', NOW).then((t) => t.hasTrendData),
      ).resolves.toBe(true);
    });

    /** A criterion added mid-window has a shorter series, not a missing one. */
    it('omits days where a criterion was not yet captured', async () => {
      snapshotRepo.find.mockResolvedValue([
        { ...snapshotOn('2026-07-01', 70, 72), criteria: [] },
        snapshotOn('2026-07-02', 80, 78),
      ]);

      const trend = await service.getTrend('org-1', NOW);
      const safeguarding = trend.criteria.find(
        (c) => c.slug === 'safeguarding',
      );

      expect(safeguarding?.points).toHaveLength(1);
      expect(safeguarding?.points[0].capturedOn).toBe('2026-07-02');
      // The overall series still covers both days.
      expect(trend.overall).toHaveLength(2);
    });
  });
});
