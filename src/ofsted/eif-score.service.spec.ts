import { Test } from '@nestjs/testing';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { EifScoreService } from './eif-score.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = { id: 'user-1', organisationId: 'org-1' } as AuthenticatedUser;

describe('EifScoreService', () => {
  const cache = { get: jest.fn(), set: jest.fn() };
  const calculator = { calculate: jest.fn() };

  let service: EifScoreService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EifScoreService,
        { provide: EifScoreCacheService, useValue: cache },
        { provide: EifScoreCalculatorService, useValue: calculator },
      ],
    }).compile();
    service = moduleRef.get(EifScoreService);
  });

  describe('getScores', () => {
    it('returns cached scores when available', async () => {
      const cached = {
        overallPercent: 80,
        overallRag: 'green',
        alertBanner: false,
        criteria: [],
        calculatedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      };
      cache.get.mockResolvedValue(cached);

      const result = await service.getScores(user);

      expect(result).toEqual({ ...cached, cached: true });
      expect(calculator.calculate).not.toHaveBeenCalled();
    });

    it('computes, caches, and returns scores on cache miss', async () => {
      cache.get.mockResolvedValue(null);
      calculator.calculate.mockResolvedValue({
        overallPercent: 65,
        alertBanner: true,
        criteria: [{ slug: 'otj', label: 'OTJ', percent: 65, rag: 'amber' }],
        calculatedAt: '2026-01-02T00:00:00.000Z',
      });

      const result = await service.getScores(user);

      expect(calculator.calculate).toHaveBeenCalledWith('org-1');
      expect(cache.set).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          overallPercent: 65,
          overallRag: 'amber',
          cached: false,
        }),
      );
      expect(result.cached).toBe(false);
      expect(result.overallRag).toBe('amber');
    });
  });
});
