import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import {
  EMPLOYER_VISIT_INTERVAL_WEEKS,
  EmployerVisitsService,
} from './employer-visits.service.js';
import { EmployerVisitLearner } from './entities/employer-visit-learner.entity.js';
import { EmployerVisit } from './entities/employer-visit.entity.js';
import { EmployerVisitType } from './enums/employer-visit-type.enum.js';

describe('EmployerVisitsService', () => {
  const visitRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const linkRepo = { find: jest.fn() };
  const enrolmentRepo = { count: jest.fn() };
  const portalService = { assertPortalType: jest.fn() };

  const manager = {
    create: jest.fn((_entity: unknown, v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };

  let service: EmployerVisitsService;

  const user = { id: 'user-1', organisationId: 'org-1' } as never;

  const dto = {
    employerOrganisationId: 'emp-1',
    visitedOn: '2026-08-03',
    visitType: EmployerVisitType.ON_SITE,
    attendees: 'Sarah Patel (Ops Manager)',
    discussionPoints: 'Progress on two apprentices',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    manager.save.mockImplementation((v: unknown) =>
      Promise.resolve(
        Array.isArray(v) ? v : { id: 'visit-1', ...(v as object) },
      ),
    );
    linkRepo.find.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmployerVisitsService,
        { provide: getRepositoryToken(EmployerVisit), useValue: visitRepo },
        {
          provide: getRepositoryToken(EmployerVisitLearner),
          useValue: linkRepo,
        },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: ReportingPortalService, useValue: portalService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(EmployerVisitsService);
  });

  /**
   * AC2. Checking only that an enrolment belongs to the provider would let a
   * visit to employer A cite a learner placed with employer B, which would
   * then appear on B's record as a meeting that never discussed them.
   */
  it('rejects learners not enrolled with the visited employer', async () => {
    enrolmentRepo.count.mockResolvedValue(1);

    await expect(
      service.create(user, { ...dto, enrolmentIds: ['enr-1', 'enr-2'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts learners that are all with this employer', async () => {
    enrolmentRepo.count.mockResolvedValue(2);

    await service.create(user, { ...dto, enrolmentIds: ['enr-1', 'enr-2'] });

    expect(enrolmentRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employerOrganisationId: 'emp-1',
          organisationId: 'org-1',
        }) as unknown,
      }),
    );
    // Visit plus links, both inside the transaction.
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates repeated learners rather than failing the count check', async () => {
    enrolmentRepo.count.mockResolvedValue(1);

    await expect(
      service.create(user, { ...dto, enrolmentIds: ['enr-1', 'enr-1'] }),
    ).resolves.toBeDefined();
  });

  it('writes no links when no learners were named', async () => {
    await service.create(user, dto);

    expect(enrolmentRepo.count).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  describe('suggestNextVisitDate', () => {
    /**
     * AC4. Counted from the last visit, not from today — a tutor recording a
     * visit three weeks late should be offered a date that keeps the rhythm,
     * not one that pushes every future visit back by the delay.
     */
    it('counts from the last visit, not from today', async () => {
      visitRepo.findOne.mockResolvedValue({ visitedOn: '2026-01-01' });

      const result = await service.suggestNextVisitDate(user, 'emp-1');

      expect(result.lastVisitedOn).toBe('2026-01-01');
      // 2026-01-01 + 12 weeks = 2026-03-26
      expect(result.suggestedDate).toBe('2026-03-26');
    });

    it('falls back to counting from today for a first visit', async () => {
      visitRepo.findOne.mockResolvedValue(null);

      const result = await service.suggestNextVisitDate(user, 'emp-1');

      const expected = new Date();
      expected.setUTCDate(
        expected.getUTCDate() + EMPLOYER_VISIT_INTERVAL_WEEKS * 7,
      );

      expect(result.lastVisitedOn).toBeNull();
      expect(result.suggestedDate).toBe(expected.toISOString().slice(0, 10));
    });
  });

  describe('lastVisitDatesByEmployer', () => {
    it('returns an empty map without querying when given no employers', async () => {
      const result = await service.lastVisitDatesByEmployer('org-1', []);

      expect(result.size).toBe(0);
      expect(visitRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('normalises a Date from MAX() to YYYY-MM-DD', async () => {
      visitRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { employerOrganisationId: 'emp-1', lastVisitedOn: '2026-05-01' },
          {
            employerOrganisationId: 'emp-2',
            lastVisitedOn: new Date('2026-06-15T00:00:00.000Z'),
          },
        ]),
      });

      const result = await service.lastVisitDatesByEmployer('org-1', [
        'emp-1',
        'emp-2',
      ]);

      expect(result.get('emp-1')).toBe('2026-05-01');
      expect(result.get('emp-2')).toBe('2026-06-15');
    });
  });
});
