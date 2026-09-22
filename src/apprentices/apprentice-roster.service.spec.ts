import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';

import { ApprenticeRosterService } from './apprentice-roster.service.js';
import { ApprenticeRosterFilter } from './dto/export-apprentice-roster.dto.js';
import { Apprentice } from './entities/apprentice.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F1.2.1 AC6 — the roster PDF is the table on screen.
 *
 * The repositories are doubles; the composition (one enrolment per
 * apprentice, chosen as the screen chooses it) and the filter-then-sort are
 * real, so these tests read the rows the PDF would print.
 */
describe('ApprenticeRosterService', () => {
  let service: ApprenticeRosterService;

  const getMany = jest.fn();
  const enrolmentFind = jest.fn();
  const organisationFindOne = jest.fn();
  const enqueue = jest.fn();

  const apprentice = (id: string, firstName: string, employeeId?: string) =>
    ({
      id,
      firstName,
      lastName: 'Learner',
      employeeId: employeeId ?? null,
    }) as Apprentice;

  const enrolment = (
    apprenticeId: string,
    overrides: Partial<Record<string, unknown>> = {},
  ) => ({
    id: `enr-${apprenticeId}-${Math.random().toString(36).slice(2)}`,
    apprenticeId,
    status: EnrolmentStatus.ACTIVE,
    otjPaceAlertLevel: 'on_track',
    epaDate: null,
    plannedStartDate: '2025-09-01',
    standardDisplayName: 'Software Developer (ST0116)',
    providerOrganisationName: 'Midlands Technical College',
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    organisationFindOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Employer Ltd',
      portalType: PortalType.EMPLOYER,
    });
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprenticeRosterService,
        {
          provide: getRepositoryToken(Apprentice),
          useValue: { createQueryBuilder: () => qb },
        },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find: enrolmentFind },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: organisationFindOne },
        },
        {
          provide: EnrolmentsService,
          // Labels are already on the fixtures, as GET /enrolments serves them.
          useValue: {
            enrichEnrolmentsForDisplay: (rows: unknown[]) =>
              Promise.resolve(rows),
          },
        },
        { provide: PdfDispatchService, useValue: { enqueue } },
      ],
    }).compile();
    service = moduleRef.get(ApprenticeRosterService);
  });

  it('prints the filtered, searched and sorted rows — not the whole roster', async () => {
    getMany.mockResolvedValue([
      apprentice('a', 'Priya', 'EMP-1'),
      apprentice('b', 'Priyanka'),
      apprentice('c', 'Tom'),
      apprentice('d', 'Priya-Mae'),
    ]);
    enrolmentFind.mockResolvedValue([
      enrolment('a', { otjPaceAlertLevel: 'at_risk', epaDate: '2026-12-01' }),
      enrolment('b', { otjPaceAlertLevel: 'off_track', epaDate: '2026-11-01' }),
      enrolment('c', { otjPaceAlertLevel: 'off_track', epaDate: '2026-10-01' }),
      enrolment('d', { otjPaceAlertLevel: 'on_track', epaDate: '2026-09-30' }),
    ]);

    const content = await service.buildPdfContent('org-1', {
      search: 'priya',
      sortBy: 'epaDate',
      sortOrder: 'asc',
    });

    // Tom is filtered out by the search; the rest are in EPA-date order.
    expect(content.rows.map((r) => r.name)).toEqual([
      'Priya-Mae Learner',
      'Priyanka Learner',
      'Priya Learner',
    ]);
    expect(content.totalCount).toBe(3);
    expect(content.rows.map((r) => r.statusLabel)).toEqual([
      'On track',
      'Critically behind',
      'At risk',
    ]);
    expect(content.rows[0].epaDate).toBe('30 Sept 2026');
    expect(content.filterSummary).toBe('search "priya"');
    expect(content.sortSummary).toBe('Sorted by EPA date, ascending.');
    expect(content.organisationName).toBe('Acme Employer Ltd');
  });

  it('applies the status pill in the screen vocabulary', async () => {
    getMany.mockResolvedValue([apprentice('a', 'Ann'), apprentice('b', 'Ben')]);
    enrolmentFind.mockResolvedValue([
      enrolment('a', { otjPaceAlertLevel: 'off_track' }),
      enrolment('b', { otjPaceAlertLevel: 'at_risk' }),
    ]);

    const content = await service.buildPdfContent('org-1', {
      filter: ApprenticeRosterFilter.CRITICALLY_BEHIND,
    });

    expect(content.rows.map((r) => r.name)).toEqual(['Ann Learner']);
    expect(content.filterSummary).toBe('status Critically behind');
  });

  it('picks the enrolment the screen picks: the active one, otherwise the newest', async () => {
    getMany.mockResolvedValue([apprentice('a', 'Ann'), apprentice('b', 'Ben')]);
    // Newest first, as GET /enrolments orders them.
    enrolmentFind.mockResolvedValue([
      enrolment('a', {
        status: EnrolmentStatus.DRAFT,
        standardDisplayName: 'Newer draft',
      }),
      enrolment('a', {
        status: EnrolmentStatus.ACTIVE,
        standardDisplayName: 'Active one',
      }),
      enrolment('b', {
        status: EnrolmentStatus.CANCELLED,
        standardDisplayName: 'Newest cancelled',
      }),
      enrolment('b', {
        status: EnrolmentStatus.DRAFT,
        standardDisplayName: 'Older draft',
      }),
    ]);

    const content = await service.buildPdfContent('org-1', {});

    expect(content.rows.map((r) => r.standard)).toEqual([
      'Active one',
      'Newest cancelled',
    ]);
  });

  it('keeps the roster order when unsorted, and shows "—" and "Pace unknown" for an apprentice with no enrolment', async () => {
    getMany.mockResolvedValue([apprentice('z', 'Zed'), apprentice('a', 'Ann')]);
    enrolmentFind.mockResolvedValue([enrolment('a')]);

    const content = await service.buildPdfContent('org-1', {});

    expect(content.rows.map((r) => r.name)).toEqual([
      'Zed Learner',
      'Ann Learner',
    ]);
    expect(content.rows[0]).toMatchObject({
      standard: '—',
      provider: '—',
      otjProgress: null,
      epaDate: null,
      statusLabel: 'Pace unknown',
    });
    expect(content.filterSummary).toBeNull();
    expect(content.sortSummary).toBeNull();
  });

  it('queues the job with the screen state and refuses non-employer organisations', async () => {
    const createdAt = new Date('2026-09-21T09:00:00.000Z');
    enqueue.mockResolvedValue({
      id: 'job-1',
      status: PdfJobStatus.QUEUED,
      template: PdfJobTemplate.APPRENTICE_ROSTER,
      outputKey: null,
      errorMessage: null,
      createdAt,
      completedAt: null,
    });
    const user = { id: 'user-1', organisationId: 'org-1' } as AuthenticatedUser;
    const query = {
      filter: ApprenticeRosterFilter.AT_RISK,
      sortBy: 'name' as const,
    };

    const result = await service.exportPdf(user, query);

    expect(enqueue).toHaveBeenCalledWith({
      organisationId: 'org-1',
      userId: 'user-1',
      template: PdfJobTemplate.APPRENTICE_ROSTER,
      rosterQuery: query,
    });
    expect(result.jobId).toBe('job-1');

    organisationFindOne.mockResolvedValue({
      id: 'org-1',
      name: 'Provider',
      portalType: PortalType.PROVIDER,
    });
    await expect(service.exportPdf(user, query)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
