import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentKsbCoverage } from './entities/enrolment-ksb-coverage.entity.js';
import { KsbCoverageAssessment } from './enums/ksb-coverage-assessment.enum.js';
import { KsbHeatmapStrength } from './enums/ksb-heatmap-strength.enum.js';
import { KsbKind } from './enums/ksb-kind.enum.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';
import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';
import { PortfolioHeatmapService } from './portfolio-heatmap.service.js';
import { staffLearnerScopeProvider } from '../../test/mocks/learner-scope.mock.js';

describe('PortfolioHeatmapService', () => {
  const coverageRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { ksbDefinitionId: 'ksb-1', evidenceItemId: 'ev-1' },
          { ksbDefinitionId: 'ksb-1', evidenceItemId: 'ev-2' },
        ]),
      })),
    },
  };
  const enrolmentContext = {
    requireEnrolment: jest.fn().mockResolvedValue({
      id: 'enr-1',
      standardId: 'std-1',
    }),
  };
  const ksbDefinitionsService = {
    findByStandard: jest.fn().mockResolvedValue([
      {
        id: 'ksb-1',
        code: 'K1',
        kind: KsbKind.KNOWLEDGE,
        title: 'K1 title',
      },
    ]),
    findEntitiesForStandard: jest.fn(),
  };
  const heatmapCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    invalidate: jest.fn(),
  };

  let service: PortfolioHeatmapService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        staffLearnerScopeProvider(),
        PortfolioHeatmapService,
        {
          provide: getRepositoryToken(EnrolmentKsbCoverage),
          useValue: coverageRepo,
        },
        { provide: PortfolioEnrolmentContext, useValue: enrolmentContext },
        { provide: KsbDefinitionsService, useValue: ksbDefinitionsService },
        { provide: PortfolioHeatmapCacheService, useValue: heatmapCache },
      ],
    }).compile();
    service = moduleRef.get(PortfolioHeatmapService);
    jest.clearAllMocks();
    heatmapCache.get.mockResolvedValue(null);
    enrolmentContext.requireEnrolment.mockResolvedValue({
      id: 'enr-1',
      standardId: 'std-1',
    });
    ksbDefinitionsService.findByStandard.mockResolvedValue([
      {
        id: 'ksb-1',
        code: 'K1',
        kind: KsbKind.KNOWLEDGE,
        title: 'K1 title',
      },
    ]);
  });

  const user = {
    id: 'u1',
    organisationId: 'org-1',
    email: 'a@example.com',
    roles: ['owner'],
  } as const;

  it('computes adequate strength when two accepted items map to a KSB', async () => {
    const result = await service.getHeatmap(user, 'enr-1');
    expect(result.cells[0].evidenceCount).toBe(2);
    expect(result.cells[0].strength).toBe(KsbHeatmapStrength.ADEQUATE);
  });

  it('upserts coverage for a KSB definition', async () => {
    const adminUser = { ...user, roles: ['owner'] };
    ksbDefinitionsService.findEntitiesForStandard.mockResolvedValue([
      { id: 'ksb-1' },
    ]);
    coverageRepo.findOne.mockResolvedValue(null);
    coverageRepo.save.mockImplementation((v: unknown) =>
      Promise.resolve({
        ...(v as object),
        assessedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    heatmapCache.invalidate.mockResolvedValue(undefined);

    const result = await service.upsertCoverage(adminUser, 'enr-1', 'ksb-1', {
      assessment: KsbCoverageAssessment.SUFFICIENT,
    });

    expect(result.ksbDefinitionId).toBe('ksb-1');
    expect(heatmapCache.invalidate).toHaveBeenCalledWith('org-1', 'enr-1');
  });
});
