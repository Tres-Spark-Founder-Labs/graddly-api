import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjSummaryService } from '../otj/otj-summary.service.js';

import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';

/** Joins every WHERE/AND WHERE fragment so a predicate can be asserted on. */
function collectPredicates(builder: {
  where: jest.Mock;
  andWhere: jest.Mock;
}): string {
  const calls: unknown[][] = [
    ...(builder.where.mock.calls as unknown[][]),
    ...(builder.andWhere.mock.calls as unknown[][]),
  ];
  return calls.map((call) => String(call[0])).join(' | ');
}

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
        /**
         * P0-A — real, not stubbed. The queries this spec asserts predicates on
         * moved into OtjSummaryService, which needs only the same repository
         * mock. Stubbing it would delete the assertions' subject.
         */
        OtjSummaryService,
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

  /**
   * F1.4.2 regression.
   *
   * `otj_log_entries.organisationId` is the apprentice's, not the employer's.
   * Filtering by it matched nothing for an employer, every enrolment scored
   * zero approved minutes, and `computePercentForEnrolment` turned that into
   * **0%** rather than null — so the provider comparison showed every
   * provider at 0% average OTJ, in red, including ones whose apprentices were
   * fully on track.
   *
   * These assertions are on the predicates rather than the result because
   * that is where the bug lived: the previous tests mocked the query builder
   * wholesale and passed throughout, which is why it survived.
   */
  it('scopes OTJ rows by enrolment, never by organisation', async () => {
    enrolmentFindBy.mockResolvedValue([
      { id: 'enr-1', plannedDurationMonths: 12 },
    ]);
    otjQueryBuilder.getRawMany.mockResolvedValue([]);

    await service.averageOtjPercentForEnrolments('org-employer', ['enr-1']);

    const predicates = collectPredicates(otjQueryBuilder);

    expect(predicates).toContain('entry.enrolmentId IN');
    expect(predicates).not.toContain('entry.organisationId');
  });

  /**
   * P0-A — the single-enrolment lookup is now one conditional-sum query in
   * `OtjSummaryService`, so the mock returns the four named columns rather than
   * a lone `total`. The property under test is unchanged and is the one that
   * matters: it must not filter on `entry.organisationId`, because those rows
   * are stamped with the provider and the caller may be the employer.
   */
  it('scopes a single enrolment lookup the same way', async () => {
    const singleQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        logged: '4200',
        pending: '600',
        approved: '3600',
        rejected: '0',
      }),
    };
    otjLogRepo.createQueryBuilder.mockReturnValueOnce(singleQueryBuilder);

    const minutes = await service.approvedMinutesForEnrolment('enr-1');

    // Approved, not logged — the delegation must not quietly widen the figure.
    expect(minutes).toBe(3600);
    expect(collectPredicates(singleQueryBuilder)).not.toContain(
      'entry.organisationId',
    );
  });
});
