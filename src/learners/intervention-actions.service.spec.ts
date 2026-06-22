import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { InterventionAction } from './entities/intervention-action.entity.js';
import { InterventionActionType } from './enums/intervention-action-type.enum.js';
import { InterventionActionsService } from './intervention-actions.service.js';

describe('InterventionActionsService', () => {
  const repo = { create: jest.fn(), save: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };
  const portalService = { assertPortalType: jest.fn() };

  let service: InterventionActionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    portalService.assertPortalType.mockResolvedValue({
      portalType: PortalType.PROVIDER,
    });
    enrolmentRepo.findOne.mockResolvedValue({ id: 'enr-1' });
    repo.create.mockImplementation((data: unknown) => data);
    repo.save.mockImplementation((data: InterventionAction) =>
      Promise.resolve({
        ...data,
        id: 'action-1',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        InterventionActionsService,
        { provide: getRepositoryToken(InterventionAction), useValue: repo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: ReportingPortalService, useValue: portalService },
      ],
    }).compile();

    service = moduleRef.get(InterventionActionsService);
  });

  it('creates an intervention action for a provider enrolment', async () => {
    const result = await service.create(
      { id: 'user-1', organisationId: 'org-1' } as never,
      'enr-1',
      {
        actionType: InterventionActionType.CONTACT_MADE,
        notes: 'Called learner',
      },
    );

    expect(portalService.assertPortalType).toHaveBeenCalledWith(
      'org-1',
      PortalType.PROVIDER,
    );
    expect(result.actionType).toBe(InterventionActionType.CONTACT_MADE);
    expect(result.notes).toBe('Called learner');
  });
});
