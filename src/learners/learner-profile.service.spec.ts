import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
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
  const portalService = { assertPortalType: jest.fn() };
  const documentsService = { listForEnrolment: jest.fn() };
  const otjMetricsService = { percentForEnrolment: jest.fn() };
  const metricsService = { loadEmployerContacts: jest.fn() };
  const interventionActionsService = { listRecentForEnrolment: jest.fn() };

  let service: LearnerProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });

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
        {
          provide: getRepositoryToken(OtjLogEntry),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(MessageThread),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
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
      ],
    }).compile();

    service = moduleRef.get(LearnerProfileService);
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
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      tutorUserId: null,
      employerOrganisationId: null,
      plannedStartDate: '2026-01-01',
      plannedEndDate: '2027-01-01',
      epaDate: null,
      apprentice: {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        status: 'active',
      },
      standard: { title: 'Software Developer' },
      employerOrganisation: null,
    });
    documentsService.listForEnrolment.mockResolvedValue([]);
    otjMetricsService.percentForEnrolment.mockResolvedValue(10);
    interventionActionsService.listRecentForEnrolment.mockResolvedValue([]);

    const profile = await service.getProfile(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
    );

    expect(profile.personal.email).toBe('jane@example.com');
    expect(profile.programme.standardTitle).toBe('Software Developer');
    expect(profile.messageThreadIds).toEqual([]);
  });
});
