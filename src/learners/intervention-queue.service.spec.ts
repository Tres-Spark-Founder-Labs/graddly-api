import { Test } from '@nestjs/testing';

import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { InterventionQueueService } from './intervention-queue.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import { InterventionFlagReason } from './utils/learner-status-badge.util.js';

describe('InterventionQueueService', () => {
  const portalService = { assertPortalType: jest.fn() };
  const metricsService = {
    loadActiveEnrolments: jest.fn(),
    buildContext: jest.fn(),
    loadEmployerContacts: jest.fn(),
    loadTutorNames: jest.fn(),
  };

  let service: InterventionQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        InterventionQueueService,
        { provide: ReportingPortalService, useValue: portalService },
        { provide: LearnerMetricsService, useValue: metricsService },
      ],
    }).compile();

    service = moduleRef.get(InterventionQueueService);
  });

  it('sorts queue entries by severity descending', async () => {
    const enrolments = [
      {
        id: 'enr-low',
        tutorUserId: null,
        employerOrganisationId: null,
        apprentice: { firstName: 'Low', lastName: 'Risk' },
        employerOrganisation: null,
      },
      {
        id: 'enr-high',
        tutorUserId: null,
        employerOrganisationId: null,
        apprentice: { firstName: 'High', lastName: 'Risk' },
        employerOrganisation: null,
      },
    ];

    metricsService.loadActiveEnrolments.mockResolvedValue(enrolments);
    metricsService.buildContext.mockImplementation(
      (enrolment: { id: string }) =>
        Promise.resolve({
          enrolment,
          flagReasons:
            enrolment.id === 'enr-high'
              ? [InterventionFlagReason.MISSED_REVIEW]
              : [InterventionFlagReason.OTJ_BEHIND],
          severityScore: enrolment.id === 'enr-high' ? 85 : 50,
          daysSinceLastActivity: 5,
        }),
    );
    metricsService.loadEmployerContacts.mockResolvedValue(new Map());
    metricsService.loadTutorNames.mockResolvedValue(new Map());

    const result = await service.list(
      { id: 'user-1', organisationId: 'org-1' } as never,
      {},
    );

    expect(result.items[0]?.enrolmentId).toBe('enr-high');
    expect(result.atRiskCount).toBe(2);
  });
});
