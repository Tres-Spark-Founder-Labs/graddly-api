import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { Review } from '../reviews/entities/review.entity.js';

import { LearnerMetricsService } from './learner-metrics.service.js';
import {
  DEFAULT_CASELOAD_AT_RISK_THRESHOLD,
  TutorCaseloadService,
} from './tutor-caseload.service.js';

describe('TutorCaseloadService', () => {
  const enrolmentRepo = { find: jest.fn(), save: jest.fn() };
  const reviewRepo = { createQueryBuilder: jest.fn() };
  const metricsService = {
    loadActiveEnrolments: jest.fn(),
    buildContext: jest.fn(),
    loadTutorNames: jest.fn(),
  };
  const portalService = { assertPortalType: jest.fn() };
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };

  let service: TutorCaseloadService;
  const user = { id: 'user-1', organisationId: 'org-1' } as never;

  const stubReviewCompliance = (
    rows: { tutorUserId: string; total: string; onTimeCount: string }[] = [],
  ) => {
    reviewRepo.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });
  };

  /** severityScore > 0 is the at-risk rule, shared with the queue. */
  const context = (tutorUserId: string | null, severityScore: number) => ({
    enrolment: { tutorUserId },
    severityScore,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    config.get.mockImplementation(
      (_key: string, fallback?: unknown) => fallback,
    );
    metricsService.loadTutorNames.mockResolvedValue(
      new Map([
        ['tutor-1', 'Tom Reid'],
        ['tutor-2', 'Ada Cole'],
      ]),
    );
    stubReviewCompliance();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TutorCaseloadService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: LearnerMetricsService, useValue: metricsService },
        { provide: ReportingPortalService, useValue: portalService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(TutorCaseloadService);
  });

  const withEnrolments = (contexts: ReturnType<typeof context>[]) => {
    metricsService.loadActiveEnrolments.mockResolvedValue(
      contexts.map((c) => c.enrolment),
    );
    metricsService.buildContext.mockImplementation((enrolment: unknown) =>
      Promise.resolve(contexts.find((c) => c.enrolment === enrolment)),
    );
  };

  it('aggregates learner and at-risk counts per tutor', async () => {
    withEnrolments([
      context('tutor-1', 3),
      context('tutor-1', 0),
      context('tutor-2', 1),
    ]);

    const result = await service.getCaseload(user);

    const tom = result.tutors.find((t) => t.tutorUserId === 'tutor-1');
    expect(tom).toMatchObject({
      tutorName: 'Tom Reid',
      learnerCount: 2,
      atRiskCount: 1,
    });
    expect(result.totalLearners).toBe(3);
    expect(result.totalAtRisk).toBe(2);
  });

  /**
   * Learners with no tutor are the most urgent caseload problem a manager
   * has — nobody is watching them — so they are reported rather than dropped.
   */
  it('reports unassigned learners as their own row', async () => {
    withEnrolments([context(null, 2), context('tutor-1', 0)]);

    const result = await service.getCaseload(user);
    const unassigned = result.tutors.find((t) => t.tutorUserId === null);

    expect(unassigned).toMatchObject({
      tutorName: 'Unassigned',
      learnerCount: 1,
      atRiskCount: 1,
      // No tutor means no reviews to attribute.
      reviewComplianceRate: null,
    });
  });

  it('sorts worst first', async () => {
    withEnrolments([
      context('tutor-1', 0),
      context('tutor-2', 5),
      context('tutor-2', 5),
    ]);

    const result = await service.getCaseload(user);

    expect(result.tutors[0].tutorUserId).toBe('tutor-2');
  });

  it('flags a tutor over the threshold', async () => {
    withEnrolments(
      Array.from({ length: DEFAULT_CASELOAD_AT_RISK_THRESHOLD + 1 }, () =>
        context('tutor-1', 3),
      ),
    );

    const result = await service.getCaseload(user);

    expect(result.atRiskThreshold).toBe(DEFAULT_CASELOAD_AT_RISK_THRESHOLD);
    expect(result.tutors[0].exceedsAtRiskThreshold).toBe(true);
  });

  it('does not flag a tutor exactly at the threshold', async () => {
    withEnrolments(
      Array.from({ length: DEFAULT_CASELOAD_AT_RISK_THRESHOLD }, () =>
        context('tutor-1', 3),
      ),
    );

    const result = await service.getCaseload(user);

    // "Exceeds" means more than, not equal to.
    expect(result.tutors[0].exceedsAtRiskThreshold).toBe(false);
  });

  it('honours a configured threshold over the default', async () => {
    config.get.mockReturnValue(1);
    withEnrolments([context('tutor-1', 3), context('tutor-1', 3)]);

    const result = await service.getCaseload(user);

    expect(result.atRiskThreshold).toBe(1);
    expect(result.tutors[0].exceedsAtRiskThreshold).toBe(true);
  });

  /**
   * "Nothing scheduled" and "everything on time" are different situations,
   * and the first is the one worth looking at.
   */
  it('reports null compliance for a tutor with no reviews', async () => {
    withEnrolments([context('tutor-1', 0)]);
    stubReviewCompliance([]);

    const result = await service.getCaseload(user);

    expect(result.tutors[0].reviewComplianceRate).toBeNull();
  });

  it('computes compliance as the on-time percentage', async () => {
    withEnrolments([context('tutor-1', 0)]);
    stubReviewCompliance([
      { tutorUserId: 'tutor-1', total: '4', onTimeCount: '3' },
    ]);

    const result = await service.getCaseload(user);

    expect(result.tutors[0].reviewComplianceRate).toBe(75);
  });

  describe('assignTutorInBulk', () => {
    /**
     * F2.2.5 AC4. The audit trail is written by a TypeORM subscriber, and
     * subscribers do not fire for `update()` or QueryBuilder writes — so a
     * bulk update would reassign thirty learners with no record that anyone
     * did. This test exists to stop that regression.
     */
    it('saves entities so the audit subscriber fires', async () => {
      const rows = [{ id: 'enr-1' }, { id: 'enr-2' }];
      enrolmentRepo.find.mockResolvedValue(rows);

      const result = await service.assignTutorInBulk(
        user,
        ['enr-1', 'enr-2'],
        'tutor-9',
      );

      expect(enrolmentRepo.save).toHaveBeenCalledWith(rows);
      expect(rows.every((r) => 'tutorUserId' in r)).toBe(true);
      expect(result.updated).toBe(2);
    });

    it('un-assigns when given null', async () => {
      const rows = [{ id: 'enr-1', tutorUserId: 'tutor-1' }];
      enrolmentRepo.find.mockResolvedValue(rows);

      await service.assignTutorInBulk(user, ['enr-1'], null);

      expect(rows[0].tutorUserId).toBeNull();
    });

    it('counts only enrolments it actually found', async () => {
      // An id from another provider is simply not returned by the scoped read.
      enrolmentRepo.find.mockResolvedValue([{ id: 'enr-1' }]);

      const result = await service.assignTutorInBulk(
        user,
        ['enr-1', 'enr-foreign'],
        'tutor-9',
      );

      expect(result.updated).toBe(1);
    });

    it('does nothing for an empty list', async () => {
      const result = await service.assignTutorInBulk(user, [], 'tutor-9');

      expect(result.updated).toBe(0);
      expect(enrolmentRepo.find).not.toHaveBeenCalled();
    });
  });
});
