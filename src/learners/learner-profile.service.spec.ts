import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BreakInLearningService } from '../enrolments/break-in-learning.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { User } from '../users/entities/user.entity.js';

import { InterventionActionsService } from './intervention-actions.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import { LearnerProfileService } from './learner-profile.service.js';

describe('LearnerProfileService', () => {
  const enrolmentRepo = { findOne: jest.fn() };
  const otjRepo = { find: jest.fn(), count: jest.fn() };
  const portalService = { assertPortalType: jest.fn() };
  const documentsService = { listForEnrolment: jest.fn() };
  const otjMetricsService = { percentForEnrolment: jest.fn() };
  const metricsService = { loadEmployerContacts: jest.fn() };
  const interventionActionsService = { listRecentForEnrolment: jest.fn() };
  const breakInLearningService = { findOpen: jest.fn() };
  const messageThreadsService = { listSummariesForEnrolment: jest.fn() };

  let service: LearnerProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
    otjRepo.find.mockResolvedValue([]);
    otjRepo.count.mockResolvedValue(0);
    documentsService.listForEnrolment.mockResolvedValue([]);
    otjMetricsService.percentForEnrolment.mockResolvedValue(10);
    interventionActionsService.listRecentForEnrolment.mockResolvedValue([]);
    breakInLearningService.findOpen.mockResolvedValue(null);
    messageThreadsService.listSummariesForEnrolment.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerProfileService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(Review),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(ReviewSignature),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        { provide: ReportingPortalService, useValue: portalService },
        { provide: LearnerDocumentsService, useValue: documentsService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        { provide: LearnerMetricsService, useValue: metricsService },
        {
          provide: InterventionActionsService,
          useValue: interventionActionsService,
        },
        { provide: BreakInLearningService, useValue: breakInLearningService },
        { provide: MessageThreadsService, useValue: messageThreadsService },
      ],
    }).compile();

    service = moduleRef.get(LearnerProfileService);
  });

  const activeEnrolment = (overrides: Record<string, unknown> = {}) => ({
    id: 'enr-1',
    tutorUserId: null,
    employerOrganisationId: null,
    plannedStartDate: '2026-01-01',
    plannedEndDate: '2027-01-01',
    epaDate: null,
    epaOrganisationName: null,
    epaOrganisationUkprn: null,
    apprentice: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      status: 'active',
    },
    standard: { title: 'Software Developer' },
    employerOrganisation: null,
    ...overrides,
  });

  it('throws when enrolment is missing', async () => {
    enrolmentRepo.findOne.mockResolvedValue(null);
    await expect(
      service.getProfile(
        { id: 'user-1', organisationId: 'org-1' } as never,
        'missing',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns profile sections for a valid enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.personal.email).toBe('jane@example.com');
    expect(profile.programme.standardTitle).toBe('Software Developer');
    expect(profile.messageThreads).toEqual([]);
  });

  // F2.2.4 AC1 — the profile used to say when the assessment was and never
  // who was doing it.
  it('exposes the EPA organisation on the programme block', async () => {
    enrolmentRepo.findOne.mockResolvedValue(
      activeEnrolment({
        epaDate: '2027-03-01',
        epaOrganisationName: 'BCS EPA',
        epaOrganisationUkprn: '10001234',
      }),
    );

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.programme.epaOrganisationName).toBe('BCS EPA');
    expect(profile.programme.epaOrganisationUkprn).toBe('10001234');
  });

  // F2.2.4 AC3 — "all sessions submitted". The screen has to be able to tell
  // that it is looking at a capped list, or it will present 500 of 812 as the
  // whole log.
  it('reports the full OTJ count and flags a truncated list', async () => {
    enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());
    otjRepo.find.mockResolvedValue([
      {
        id: 'otj-1',
        loggedDate: '2026-05-01',
        minutes: 120,
        status: 'approved',
        activityName: 'Shadowing',
        flaggedAt: new Date('2026-05-02T09:00:00.000Z'),
        flagNote: 'Hours look high for a half day',
      },
    ]);
    otjRepo.count.mockResolvedValue(812);

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.otj.totalCount).toBe(812);
    expect(profile.otj.truncated).toBe(true);
    expect(profile.otj.recentEntries[0]).toMatchObject({
      activityName: 'Shadowing',
      flaggedAt: '2026-05-02T09:00:00.000Z',
      flagNote: 'Hours look high for a half day',
    });
  });

  it('does not report truncation when the whole log is returned', async () => {
    enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());
    otjRepo.find.mockResolvedValue([
      {
        id: 'otj-1',
        loggedDate: '2026-05-01',
        minutes: 120,
        status: 'approved',
        activityName: 'Shadowing',
        flaggedAt: null,
        flagNote: null,
      },
    ]);
    otjRepo.count.mockResolvedValue(1);

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.otj.truncated).toBe(false);
    expect(profile.otj.recentEntries[0].flaggedAt).toBeNull();
  });

  // F2.2.4 AC6 — these two fields were hardcoded `null`, so a paused learner
  // showed as paused for no stated reason with no stated return date.
  it('reads the break reason and expected return from the open break', async () => {
    enrolmentRepo.findOne.mockResolvedValue(
      activeEnrolment({
        apprentice: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          status: 'paused',
        },
      }),
    );
    breakInLearningService.findOpen.mockResolvedValue({
      reason: 'Maternity leave',
      expectedReturnDate: '2026-11-01',
    });

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.breakInLearning).toMatchObject({
      active: true,
      reason: 'Maternity leave',
      expectedReturnDate: '2026-11-01',
    });
  });

  it('reports a paused learner with no recorded break rather than inventing one', async () => {
    enrolmentRepo.findOne.mockResolvedValue(
      activeEnrolment({
        apprentice: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          status: 'paused',
        },
      }),
    );
    breakInLearningService.findOpen.mockResolvedValue(null);

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.breakInLearning.active).toBe(true);
    expect(profile.breakInLearning.reason).toBeNull();
    expect(profile.breakInLearning.expectedReturnDate).toBeNull();
  });

  // F2.2.4 AC5 — summaries, not bare ids. The access decision stays in the
  // messaging service, so the profile must hand it the caller.
  it('asks messaging for thread summaries as the requesting user', async () => {
    enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());
    messageThreadsService.listSummariesForEnrolment.mockResolvedValue([
      {
        id: 'thread-1',
        counterpartyParty: 'tutor',
        counterpartyUserId: 'user-9',
        counterpartyName: 'Ade Tutor',
        messageCount: 4,
        unreadCount: 1,
        lastMessageAt: '2026-06-01T10:00:00.000Z',
        lastMessagePreview: 'Can we move Thursday?',
        lastMessageSenderUserId: 'user-9',
        archivedAt: null,
      },
    ]);
    const user = { id: 'user-1', organisationId: 'org-1' };

    const profile = await service.getProfile(user as never, 'enr-1');

    expect(
      messageThreadsService.listSummariesForEnrolment,
    ).toHaveBeenCalledWith(user, 'enr-1');
    expect(profile.messageThreads).toHaveLength(1);
    expect(profile.messageThreads[0].lastMessagePreview).toBe(
      'Can we move Thursday?',
    );
  });
});
