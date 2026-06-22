import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { SafeguardingChecklistItem } from './entities/safeguarding-checklist-item.entity.js';
import { SafeguardingChecklistService } from './safeguarding-checklist.service.js';

describe('SafeguardingChecklistService', () => {
  const repo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const eifScoreCache = { invalidate: jest.fn() };

  let service: SafeguardingChecklistService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SafeguardingChecklistService,
        {
          provide: getRepositoryToken(SafeguardingChecklistItem),
          useValue: repo,
        },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();
    service = moduleRef.get(SafeguardingChecklistService);
  });

  it('returns completion percent from checklist items', async () => {
    repo.count.mockResolvedValue(4);
    repo.find.mockResolvedValue([
      { completedAt: new Date() },
      { completedAt: new Date() },
      { completedAt: null },
      { completedAt: null },
    ]);

    const percent = await service.completionPercent('org-1');
    expect(percent).toBe(50);
  });
});
