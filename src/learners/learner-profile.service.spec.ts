import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BreakInLearningService } from '../enrolments/break-in-learning.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
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
  const documentsService = { listForEnrolment: jest.fn() };
  const otjMetricsService = { percentForEnrolment: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const metricsService = {
    loadEmployerContacts: jest.fn(),
    loadTutorNames: jest.fn(),
    loadOrganisationNames: jest.fn(),
  };
  const interventionActionsService = { listRecentForEnrolment: jest.fn() };
  const breakInLearningService = { findOpen: jest.fn() };
  const messageThreadsService = { listSummariesForEnrolment: jest.fn() };

  let service: LearnerProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    otjRepo.find.mockResolvedValue([]);
    otjRepo.count.mockResolvedValue(0);
    documentsService.listForEnrolment.mockResolvedValue([]);
    otjMetricsService.percentForEnrolment.mockResolvedValue(10);
    interventionActionsService.listRecentForEnrolment.mockResolvedValue([]);
    breakInLearningService.findOpen.mockResolvedValue(null);
    messageThreadsService.listSummariesForEnrolment.mockResolvedValue([]);
    userRepo.findOne.mockResolvedValue(null);
    metricsService.loadTutorNames.mockResolvedValue(new Map());
    metricsService.loadOrganisationNames.mockResolvedValue(new Map());

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
        { provide: getRepositoryToken(User), useValue: userRepo },
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

  /** The provider that owns the enrolment — not, in general, the caller. */
  const PROVIDER_ORG = 'provider-org-1';

  const activeEnrolment = (overrides: Record<string, unknown> = {}) => ({
    id: 'enr-1',
    organisationId: PROVIDER_ORG,
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

  /**
   * F1.2.2 AC1 names the tutor. The aggregate used to read `users` here
   * directly, which `users_select` refuses for an employer caller — the
   * tutor belongs to the provider's organisation — so the response carried a
   * non-null `tutor.userId` beside a null `tutor.name`.
   */
  describe('the tutor name', () => {
    it('comes from the display-name hydrator, not from this service reading users', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        activeEnrolment({ tutorUserId: 'tutor-1' }),
      );
      metricsService.loadTutorNames.mockResolvedValue(
        new Map([['tutor-1', 'Rowan Bell']]),
      );

      const result = await service.getProfile(
        { id: 'user-1', organisationId: 'employer-org-1' } as never,
        'enr-1',
      );

      expect(metricsService.loadTutorNames).toHaveBeenCalledWith(['tutor-1']);
      expect(result.tutor).toEqual({ userId: 'tutor-1', name: 'Rowan Bell' });
      // The read this replaced. The line-manager read stays on userRepo, so
      // the assertion is about the tutor id specifically.
      expect(userRepo.findOne).not.toHaveBeenCalledWith({
        where: { id: 'tutor-1' },
      });
    });

    it('asks for nothing when the enrolment has no tutor', async () => {
      enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

      const result = await service.getProfile(
        { id: 'user-1', organisationId: PROVIDER_ORG } as never,
        'enr-1',
      );

      // An empty list rather than a skipped call: loadTutorNames returns
      // early on it and never opens the bootstrap window.
      expect(metricsService.loadTutorNames).toHaveBeenCalledWith([]);
      expect(result.tutor).toEqual({ userId: null, name: null });
    });

    it('reports a name the hydrator could not resolve as absent, not as a blank row', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        activeEnrolment({ tutorUserId: 'tutor-gone' }),
      );
      metricsService.loadTutorNames.mockResolvedValue(new Map());

      const result = await service.getProfile(
        { id: 'user-1', organisationId: PROVIDER_ORG } as never,
        'enr-1',
      );

      expect(result.tutor).toEqual({ userId: 'tutor-gone', name: null });
    });
  });

  describe('authorisation is not scoping', () => {
    it('admits the owning provider or the employer named on the enrolment, and nobody else', async () => {
      enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

      await service.getProfile(
        { id: 'user-1', organisationId: 'employer-org-1' } as never,
        'enr-1',
      );

      const calls = enrolmentRepo.findOne.mock.calls as [
        { where: Record<string, unknown>[] },
      ][];
      const { where } = calls[0][0];

      // An array is an OR. Two arms, both pinning the id.
      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(2);
      expect(where[0]).toMatchObject({
        id: 'enr-1',
        organisationId: 'employer-org-1',
        isDeleted: false,
      });
      expect(where[1]).toMatchObject({
        id: 'enr-1',
        employerOrganisationId: 'employer-org-1',
        isDeleted: false,
      });

      // providerOrganisationId is a link column and the owner is already
      // admitted by the first arm. Matching it too would widen the route past
      // the two parties the PRD names.
      expect(JSON.stringify(where)).not.toContain('providerOrganisationId');
    });

    it('scopes every sub-read by the enrolment owner, not by the caller', async () => {
      enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

      await service.getProfile(
        { id: 'user-1', organisationId: 'employer-org-1' } as never,
        'enr-1',
      );

      // The defect this guards: each of these used to be handed the caller's
      // organisation, so an employer got an empty profile rather than a 403.
      expect(documentsService.listForEnrolment).toHaveBeenCalledWith(
        PROVIDER_ORG,
        'enr-1',
      );
      expect(
        interventionActionsService.listRecentForEnrolment,
      ).toHaveBeenCalledWith(PROVIDER_ORG, 'enr-1');
      expect(breakInLearningService.findOpen).toHaveBeenCalledWith(
        PROVIDER_ORG,
        'enr-1',
      );

      for (const call of otjRepo.find.mock.calls as { where: unknown }[][]) {
        expect(call[0].where).toMatchObject({ organisationId: PROVIDER_ORG });
      }
      for (const call of otjRepo.count.mock.calls as { where: unknown }[][]) {
        expect(call[0].where).toMatchObject({ organisationId: PROVIDER_ORG });
      }

      // Messaging is the exception, and deliberately so: its access rule is
      // about the two participants, so it is handed the caller.
      expect(
        messageThreadsService.listSummariesForEnrolment,
      ).toHaveBeenCalledWith(
        { id: 'user-1', organisationId: 'employer-org-1' },
        'enr-1',
      );
    });

    it('still scopes by the owner when the caller is the provider', async () => {
      enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

      await service.getProfile(
        { id: 'user-1', organisationId: PROVIDER_ORG } as never,
        'enr-1',
      );

      expect(documentsService.listForEnrolment).toHaveBeenCalledWith(
        PROVIDER_ORG,
        'enr-1',
      );
    });
  });

  /**
   * F1.2.2 AC1 — "provider" in the personal details. The profile carried no
   * provider at all; the roster carried one only when the link column was
   * set, which it is not when the provider owns the enrolment.
   */
  describe('the provider', () => {
    it('is the owning organisation when no separate provider link is set', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        activeEnrolment({ providerOrganisationId: null }),
      );
      metricsService.loadOrganisationNames.mockResolvedValue(
        new Map([[PROVIDER_ORG, 'Provider Co']]),
      );

      const profile = await service.getProfile(
        { id: 'user-1', organisationId: 'org-1' } as never,
        'enr-1',
      );

      expect(profile.provider).toEqual({
        organisationId: PROVIDER_ORG,
        name: 'Provider Co',
      });
      expect(metricsService.loadOrganisationNames).toHaveBeenCalledWith([
        PROVIDER_ORG,
      ]);
    });

    it('is the linked provider when one is set', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        activeEnrolment({ providerOrganisationId: 'linked-provider' }),
      );
      metricsService.loadOrganisationNames.mockResolvedValue(
        new Map([['linked-provider', 'Subcontracted Ltd']]),
      );

      const profile = await service.getProfile(
        { id: 'user-1', organisationId: 'org-1' } as never,
        'enr-1',
      );

      expect(profile.provider).toEqual({
        organisationId: 'linked-provider',
        name: 'Subcontracted Ltd',
      });
    });

    it('carries the id with a null name when the read returned nothing', async () => {
      enrolmentRepo.findOne.mockResolvedValue(activeEnrolment());

      const profile = await service.getProfile(
        { id: 'user-1', organisationId: 'org-1' } as never,
        'enr-1',
      );

      expect(profile.provider).toEqual({
        organisationId: PROVIDER_ORG,
        name: null,
      });
    });
  });
  /**
   * The bootstrap windows run after the scoped reads, never beside them.
   *
   * The flag is request-scoped, so a window opened inside the profile's
   * Promise.all covered its siblings' statements: the employer's evidence
   * read matched app_rls_bootstrap() and owner-only portfolio evidence
   * appeared in the employer's library. Caught by the e2e under graddly_app.
   * This pins the ordering so it cannot drift back into the batch.
   */
  describe('the display-name windows', () => {
    it('open only after every scoped read has resolved', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        activeEnrolment({ tutorUserId: 'tutor-1' }),
      );
      let releaseDocuments = () => {};
      documentsService.listForEnrolment.mockReturnValue(
        new Promise((resolve) => {
          releaseDocuments = () => resolve([]);
        }),
      );

      const pending = service.getProfile(
        { id: 'user-1', organisationId: 'org-1' } as never,
        'enr-1',
      );
      // Let every synchronous part of the batch start.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });

      expect(metricsService.loadTutorNames).not.toHaveBeenCalled();
      expect(metricsService.loadOrganisationNames).not.toHaveBeenCalled();

      releaseDocuments();
      await pending;

      expect(metricsService.loadTutorNames).toHaveBeenCalledWith(['tutor-1']);
      expect(metricsService.loadOrganisationNames).toHaveBeenCalledWith([
        PROVIDER_ORG,
      ]);
    });
  });
});
