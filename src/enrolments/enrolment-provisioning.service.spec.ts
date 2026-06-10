import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InvitationsService } from '../invitations/invitations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { UsersService } from '../users/users.service.js';

import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { EnrolmentProvisioningService } from './enrolment-provisioning.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentPipelineState } from './enums/enrolment-pipeline-state.enum.js';

describe('EnrolmentProvisioningService', () => {
  let service: EnrolmentProvisioningService;
  const config = { get: jest.fn() };
  const usersService = { findByEmail: jest.fn() };
  const notificationsService = { createForUser: jest.fn() };
  const pipelineService = { advanceIfAhead: jest.fn() };
  const invitationsService = { createForEnrolment: jest.fn() };
  const enrolmentSave = jest.fn();
  const membershipFind = jest.fn();

  const actor = {
    id: 'user-1',
    organisationId: 'org-1',
  } as const;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentProvisioningService,
        { provide: ConfigService, useValue: config },
        { provide: UsersService, useValue: usersService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EnrolmentPipelineService, useValue: pipelineService },
        { provide: InvitationsService, useValue: invitationsService },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: { save: enrolmentSave },
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: { find: membershipFind },
        },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentProvisioningService);
    jest.clearAllMocks();
    config.get.mockReturnValue(true);
    membershipFind.mockResolvedValue([]);
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );
    pipelineService.advanceIfAhead.mockResolvedValue({});
  });

  it('links existing user and advances to account_created', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'existing-user' });
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      apprenticeUserId: null,
      apprentice: { email: 'app@example.com' },
    } as Enrolment;

    await service.onActivate(enrolment, actor);

    expect(enrolmentSave).toHaveBeenCalledWith(
      expect.objectContaining({ apprenticeUserId: 'existing-user' }),
    );
    expect(pipelineService.advanceIfAhead).toHaveBeenCalledWith(
      'enr-1',
      EnrolmentPipelineState.ACCOUNT_CREATED,
    );
    expect(invitationsService.createForEnrolment).not.toHaveBeenCalled();
  });

  it('creates invitation when no user exists', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      apprentice: { email: 'new-app@example.com' },
    } as Enrolment;

    await service.onActivate(enrolment, actor);

    expect(invitationsService.createForEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new-app@example.com',
        enrolmentId: 'enr-1',
        organisationId: 'org-1',
      }),
    );
    expect(pipelineService.advanceIfAhead).toHaveBeenCalledWith(
      'enr-1',
      EnrolmentPipelineState.INVITED,
    );
  });

  it('no-ops when auto invite disabled', async () => {
    config.get.mockReturnValue(false);
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      apprentice: { email: 'app@example.com' },
    } as Enrolment;

    await service.onActivate(enrolment, actor);

    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(invitationsService.createForEnrolment).not.toHaveBeenCalled();
  });

  it('onInvitationAccepted links user and advances pipeline', async () => {
    const enrolmentSaveForAccept = jest.fn().mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentProvisioningService,
        { provide: ConfigService, useValue: config },
        { provide: UsersService, useValue: usersService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EnrolmentPipelineService, useValue: pipelineService },
        { provide: InvitationsService, useValue: invitationsService },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'enr-1',
              apprenticeUserId: null,
            }),
            save: enrolmentSaveForAccept,
          },
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: { find: membershipFind },
        },
      ],
    }).compile();

    const acceptService = moduleRef.get(EnrolmentProvisioningService);
    await acceptService.onInvitationAccepted(
      { enrolmentId: 'enr-1' } as never,
      'linked-user',
    );

    expect(enrolmentSaveForAccept).toHaveBeenCalledWith(
      expect.objectContaining({ apprenticeUserId: 'linked-user' }),
    );
    expect(pipelineService.advanceIfAhead).toHaveBeenCalledWith(
      'enr-1',
      EnrolmentPipelineState.ACCOUNT_CREATED,
    );
  });
});
