import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { RedisService } from '../redis/redis.service.js';

import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';

describe('PortfolioHeatmapCacheService', () => {
  const redisClient = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  const redis = { getClient: () => redisClient };
  const configGet = jest.fn();
  let service: PortfolioHeatmapCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    configGet.mockReturnValue(3600);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PortfolioHeatmapCacheService,
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = moduleRef.get(PortfolioHeatmapCacheService);
  });

  describe('get', () => {
    it('returns null on cache miss', async () => {
      redisClient.get.mockResolvedValue(null);

      await expect(service.get('org-1', 'enr-1')).resolves.toBeNull();
      expect(redisClient.get).toHaveBeenCalledWith(
        'portfolio:heatmap:org-1:enr-1',
      );
    });

    it('returns parsed cells on cache hit', async () => {
      const cells = [{ ksbDefinitionId: 'ksb-1', strength: 'strong' }];
      redisClient.get.mockResolvedValue(JSON.stringify(cells));

      await expect(service.get('org-1', 'enr-1')).resolves.toEqual(cells);
    });

    it('skips redis when TTL is 0', async () => {
      configGet.mockReturnValue(0);

      await expect(service.get('org-1', 'enr-1')).resolves.toBeNull();
      expect(redisClient.get).not.toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('stores cells with TTL', async () => {
      const cells = [{ ksbDefinitionId: 'ksb-1', strength: 'strong' }];

      await service.set('org-1', 'enr-1', cells as never);

      expect(redisClient.setex).toHaveBeenCalledWith(
        'portfolio:heatmap:org-1:enr-1',
        3600,
        JSON.stringify(cells),
      );
    });

    it('skips redis when TTL is 0', async () => {
      configGet.mockReturnValue(0);

      await service.set('org-1', 'enr-1', [] as never);

      expect(redisClient.setex).not.toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('deletes the cache key', async () => {
      await service.invalidate('org-1', 'enr-1');

      expect(redisClient.del).toHaveBeenCalledWith(
        'portfolio:heatmap:org-1:enr-1',
      );
    });

    it('skips redis when TTL is 0', async () => {
      configGet.mockReturnValue(0);

      await service.invalidate('org-1', 'enr-1');

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });
});
