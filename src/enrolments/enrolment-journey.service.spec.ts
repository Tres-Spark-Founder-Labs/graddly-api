import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

describe('EnrolmentJourneyService', () => {
  let service: EnrolmentJourneyService;
  const enrolmentsService = { findOne: jest.fn() };
  const enrolmentRepo = { save: jest.fn() };
  const standardRepo = { findOne: jest.fn() };
  const otjRepo = {
    createQueryBuilder: jest.fn(),
  };
  const commitmentGroupRepo = { findOne: jest.fn() };
  const commitmentRepo = { findOne: jest.fn() };
  const reviewRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const membershipRepo = { find: jest.fn() };
  const notifications = { createForUser: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentJourneyService,
        { provide: EnrolmentsService, useValue: enrolmentsService },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(Standard), useValue: standardRepo },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: commitmentGroupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentJourneyService);
    jest.clearAllMocks();

    otjRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '2400' }),
    });
    commitmentGroupRepo.findOne.mockResolvedValue(null);
    reviewRepo.find.mockResolvedValue([]);
    reviewRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    });
    standardRepo.findOne.mockResolvedValue({ gatewayCriteria: null });
    enrolmentRepo.save.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );
    membershipRepo.find.mockResolvedValue([]);
  });

  it('returns journey with milestones, checklist, and EPA countdown', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: new Date('2025-01-15T00:00:00.000Z'),
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
      plannedDurationMonths: 18,
      epaDate: '2026-09-01',
      completedAt: null,
      gatewayReadyNotifiedAt: null,
    } as Enrolment;

    enrolmentsService.findOne.mockResolvedValue(enrolment);

    const journey = await service.getJourney(
      { id: 'u1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(journey.enrolmentId).toBe('enr-1');
    expect(journey.epaDate).toBe('2026-09-01');
    expect(journey.daysToEpa).not.toBeNull();
    expect(journey.milestones.length).toBeGreaterThan(0);
    expect(journey.gatewayChecklist.length).toBe(4);
    expect(journey.pace.approvedMinutes).toBe(2400);
  });

  it('updates EPA date via patch journey flow', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      status: EnrolmentStatus.ACTIVE,
      activatedAt: new Date('2025-01-15T00:00:00.000Z'),
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
      plannedDurationMonths: 18,
      epaDate: null,
      completedAt: null,
      gatewayReadyNotifiedAt: null,
    } as Enrolment;

    enrolmentsService.findOne.mockResolvedValue(enrolment);

    const journey = await service.updateJourney(
      { id: 'u1', organisationId: 'org-1' } as never,
      'enr-1',
      { epaDate: '2026-06-01' },
    );

    expect(enrolment.epaDate).toBe('2026-06-01');
    expect(journey.epaDate).toBe('2026-06-01');
    expect(journey.epaCountdownBand).not.toBe('unset');
  });
});
