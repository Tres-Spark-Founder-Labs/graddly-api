import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

describe('EnrolmentsService', () => {
  let service: EnrolmentsService;

  const enrolmentFindOne = jest.fn();
  const enrolmentSave = jest.fn();
  const apprenticeFindOne = jest.fn();
  const standardFindOne = jest.fn();
  const organisationFindOne = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentsService,
        {
          provide: getRepositoryToken(Enrolment),
          useValue: {
            findOne: enrolmentFindOne,
            save: enrolmentSave,
          },
        },
        {
          provide: getRepositoryToken(Apprentice),
          useValue: { findOne: apprenticeFindOne },
        },
        {
          provide: getRepositoryToken(Standard),
          useValue: { findOne: standardFindOne },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: organisationFindOne },
        },
        {
          provide: WithdrawalPushService,
          useValue: {
            queueFromEnrolment: jest.fn(),
          },
        },
        {
          provide: MessageThreadsService,
          useValue: { archiveForEnrolment: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentsService);
    jest.clearAllMocks();
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;

  it('activates draft enrolment', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.DRAFT,
    } as Enrolment;

    enrolmentFindOne.mockResolvedValue(enrolment);
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );

    const result = await service.activate(user, 'enr-1');
    expect(result.status).toBe(EnrolmentStatus.ACTIVE);
    expect(result.activatedAt).toBeInstanceOf(Date);
  });

  it('rejects completion from draft', async () => {
    enrolmentFindOne.mockResolvedValue({
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.DRAFT,
    });

    await expect(service.complete(user, 'enr-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updates participant user IDs', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.ACTIVE,
      apprenticeUserId: null,
      tutorUserId: null,
      employerManagerUserId: null,
    } as Enrolment;

    enrolmentFindOne.mockResolvedValue(enrolment);
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );

    const result = await service.updateParticipants(user, 'enr-1', {
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-mgr',
    });

    expect(result.apprenticeUserId).toBe('u-app');
    expect(result.tutorUserId).toBe('u-tutor');
    expect(result.employerManagerUserId).toBe('u-mgr');
  });

  it('updates organisation link IDs', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.ACTIVE,
      employerOrganisationId: null,
      providerOrganisationId: null,
    } as Enrolment;

    enrolmentFindOne.mockResolvedValue(enrolment);
    organisationFindOne.mockResolvedValue({ id: 'emp-1', isDeleted: false });
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );

    const result = await service.updateOrganisationLinks(user, 'enr-1', {
      employerOrganisationId: 'emp-1',
    });

    expect(result.employerOrganisationId).toBe('emp-1');
  });

  it('cancels active enrolment', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.ACTIVE,
    } as Enrolment;
    enrolmentFindOne.mockResolvedValue(enrolment);
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );

    const result = await service.cancel(user, 'enr-1');
    expect(result.status).toBe(EnrolmentStatus.CANCELLED);
    expect(result.cancelledAt).toBeInstanceOf(Date);
  });
});
