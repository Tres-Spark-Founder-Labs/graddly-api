import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';

import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';

describe('OtjProgressMetricsService', () => {
  let service: OtjProgressMetricsService;

  const otjQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
  const otjLogRepo = {
    createQueryBuilder: jest.fn(() => otjQueryBuilder),
  };
  const enrolmentFindBy = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjProgressMetricsService,
        {
          provide: getRepositoryToken(OtjLogEntry),
          useValue: otjLogRepo,
        },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { findBy: enrolmentFindBy },
        },
      ],
    }).compile();

    service = moduleRef.get(OtjProgressMetricsService);
    jest.clearAllMocks();
  });

  it('computes average OTJ percent from approved minutes', async () => {
    enrolmentFindBy.mockResolvedValue([
      { id: 'enr-1', plannedDurationMonths: 12 },
      { id: 'enr-2', plannedDurationMonths: 12 },
    ]);
    otjQueryBuilder.getRawMany.mockResolvedValue([
      { enrolmentId: 'enr-1', approvedMinutes: '7200' },
      { enrolmentId: 'enr-2', approvedMinutes: '3600' },
    ]);

    const result = await service.averageOtjPercentForEnrolments('org-1', [
      'enr-1',
      'enr-2',
    ]);

    expect(result).toBe(37.5);
  });

  it('returns null when planned duration is zero', () => {
    expect(
      service.computePercentForEnrolment({ plannedDurationMonths: 0 }, 120),
    ).toBeNull();
  });
});
