import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { EmployerDirectoryService } from './employer-directory.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

describe('EmployerDirectoryService', () => {
  let service: EmployerDirectoryService;

  const portalService = {
    assertPortalType: jest.fn(),
  };
  const otjMetricsService = {
    averageOtjPercentForEnrolments: jest.fn(),
  };
  const enrolmentFind = jest.fn();
  const organisationFindBy = jest.fn();
  const membershipFind = jest.fn();
  const commitmentFind = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmployerDirectoryService,
        CommitmentPipelineService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: OtjProgressMetricsService, useValue: otjMetricsService },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { find: enrolmentFind },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findBy: organisationFindBy },
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: { find: membershipFind },
        },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: { find: commitmentFind },
        },
      ],
    }).compile();

    service = moduleRef.get(EmployerDirectoryService);
    jest.clearAllMocks();
  });

  it('returns paginated directory rows for provider orgs', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
    enrolmentFind.mockResolvedValue([
      {
        id: 'enr-1',
        employerOrganisationId: 'emp-1',
        status: EnrolmentStatus.ACTIVE,
      },
    ]);
    organisationFindBy.mockResolvedValue([
      {
        id: 'emp-1',
        name: 'Acme Ltd',
        city: 'London',
        orgEmail: 'hr@acme.co.uk',
      },
    ]);
    membershipFind.mockResolvedValue([
      {
        organisation: { id: 'emp-1' },
        user: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@acme.co.uk',
        },
      },
    ]);
    commitmentFind.mockResolvedValue([]);
    otjMetricsService.averageOtjPercentForEnrolments.mockResolvedValue(55);

    const result = await service.list('provider-1', { page: 1, perPage: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].organisationName).toBe('Acme Ltd');
    expect(result.items[0].averageOtjPercent).toBe(55);
    expect(result.items[0].commitmentPipelineStatus).toBe(
      CommitmentPipelineStatus.NONE,
    );
    expect(result.items[0].lastVisitDate).toBeNull();
  });

  it('returns empty directory when no linked enrolments exist', async () => {
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
    enrolmentFind.mockResolvedValue([]);

    const result = await service.list('provider-1', {});

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('rejects employer portal orgs', async () => {
    portalService.assertPortalType.mockRejectedValue(
      new ForbiddenException('provider only'),
    );

    await expect(service.list('org-employer', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
