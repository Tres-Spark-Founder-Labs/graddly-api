import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { LearnerCohortService } from './learner-cohort.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import { LearnerStatusBadge } from './utils/learner-status-badge.util.js';

describe('LearnerCohortService', () => {
  const portalService = { assertPortalType: jest.fn() };
  const metricsService = {
    loadActiveEnrolments: jest.fn(),
    buildContext: jest.fn(),
    loadTutorNames: jest.fn(),
  };
  const otjMetricsService = { percentForEnrolment: jest.fn() };
  // F2.2.1 AC5 — the PDF export names the org and queues a job.
  const organisationRepo = { findOne: jest.fn() };
  const pdfDispatch = { enqueue: jest.fn() };

  let service: LearnerCohortService;

  beforeEach(async () => {
    jest.clearAllMocks();
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerCohortService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: LearnerMetricsService, useValue: metricsService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: PdfDispatchService, useValue: pdfDispatch },
      ],
    }).compile();

    service = moduleRef.get(LearnerCohortService);
  });

  it('returns paginated cohort rows', async () => {
    const enrolment = {
      id: 'enr-1',
      tutorUserId: 'tutor-1',
      employerOrganisationId: 'emp-1',
      plannedStartDate: '2026-01-01',
      epaDate: '2026-09-01',
      apprentice: { firstName: 'Jane', lastName: 'Smith' },
      standard: { title: 'Software Developer' },
      employerOrganisation: { name: 'Acme Ltd' },
    };

    metricsService.loadActiveEnrolments.mockResolvedValue([enrolment]);
    metricsService.buildContext.mockResolvedValue({
      enrolment,
      statusBadge: LearnerStatusBadge.ON_TRACK,
      nextReviewDate: new Date('2026-06-15T10:00:00.000Z'),
    });
    otjMetricsService.percentForEnrolment.mockResolvedValue(42.5);
    metricsService.loadTutorNames.mockResolvedValue(
      new Map([['tutor-1', 'Alex Tutor']]),
    );

    const result = await service.list(
      { id: 'user-1', organisationId: 'org-1' } as never,
      { page: 1, perPage: 20 },
    );

    expect('csv' in result).toBe(false);
    if ('csv' in result) {
      throw new Error('expected paginated JSON result');
    }
    expect(result.items[0]?.learnerName).toBe('Jane Smith');
    expect(result.items[0]?.otjPercent).toBe(42.5);
  });

  it('returns CSV when format=csv', async () => {
    metricsService.loadActiveEnrolments.mockResolvedValue([]);
    const result = await service.list(
      { id: 'user-1', organisationId: 'org-1' } as never,
      { format: 'csv' },
    );

    expect('csv' in result).toBe(true);
    if (!('csv' in result)) {
      throw new Error('expected CSV result');
    }
    expect(result.csv).toContain('enrolmentId');
  });
});
