import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { RedisService } from '../redis/redis.service.js';

import { EifScoreCacheService } from './eif-score-cache.service.js';

describe('EifScoreCacheService', () => {
  const redisClient = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };
  const redis = { getClient: () => redisClient };
  let configGet = jest.fn().mockReturnValue(3600);
  let service: EifScoreCacheService;

  beforeEach(async () => {
    configGet = jest.fn().mockReturnValue(3600);
    const moduleRef = await Test.createTestingModule({
      providers: [
        EifScoreCacheService,
        { provide: RedisService, useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();
    service = moduleRef.get(EifScoreCacheService);
    jest.clearAllMocks();
  });

  it('returns null on cache miss', async () => {
    redisClient.get.mockResolvedValue(null);
    await expect(service.get('org-1')).resolves.toBeNull();
  });

  it('stores and reads cached payload', async () => {
    const payload = {
      overallPercent: 70,
      overallRag: 'amber',
      alertBanner: false,
      criteria: [],
      calculatedAt: '2026-01-01T00:00:00.000Z',
      cached: false,
    };
    redisClient.get.mockResolvedValue(JSON.stringify(payload));
    await expect(service.get('org-1')).resolves.toEqual(payload);
    await service.set('org-1', payload);
    expect(redisClient.setex).toHaveBeenCalledWith(
      'eif:scores:org-1',
      3600,
      JSON.stringify(payload),
    );
  });

  it('skips redis when TTL is 0', async () => {
    configGet.mockReturnValue(0);
    await expect(service.get('org-1')).resolves.toBeNull();
    await service.set('org-1', {
      overallPercent: 0,
      overallRag: 'red',
      alertBanner: true,
      criteria: [],
      calculatedAt: '2026-01-01T00:00:00.000Z',
      cached: false,
    });
    await service.invalidate('org-1');
    expect(redisClient.get).not.toHaveBeenCalled();
    expect(redisClient.setex).not.toHaveBeenCalled();
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('invalidates organisation cache key', async () => {
    await service.invalidate('org-1');
    expect(redisClient.del).toHaveBeenCalledWith('eif:scores:org-1');
  });
});
