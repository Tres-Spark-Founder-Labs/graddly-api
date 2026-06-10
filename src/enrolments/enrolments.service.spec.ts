import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { CompletionPushService } from '../completion-push/completion-push.service.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { EnrolmentProvisioningService } from './enrolment-provisioning.service.js';
import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EpaOutcomeRecord } from './entities/epa-outcome.entity.js';
import { EnrolmentPipelineState } from './enums/enrolment-pipeline-state.enum.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

describe('EnrolmentsService', () => {
  let service: EnrolmentsService;

  const pipelineService = {
    advanceIfAhead: jest.fn(),
    isAtLeast: jest.fn().mockReturnValue(true),
  };
  const enrolmentFindOne = jest.fn();
  const enrolmentSave = jest.fn();
  const enrolmentCreate = jest.fn();
  const enrolmentFindAndCount = jest.fn();
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
            create: enrolmentCreate,
            findAndCount: enrolmentFindAndCount,
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
          provide: getRepositoryToken(EpaOutcomeRecord),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: WithdrawalPushService,
          useValue: {
            queueFromEnrolment: jest.fn(),
          },
        },
        {
          provide: CompletionPushService,
          useValue: {
            queueFromEnrolmentCompleted: jest.fn(),
            queueFromEpaOutcome: jest.fn(),
          },
        },
        {
          provide: MessageThreadsService,
          useValue: { archiveForEnrolment: jest.fn() },
        },
        {
          provide: EnrolmentPipelineService,
          useValue: pipelineService,
        },
        {
          provide: EnrolmentProvisioningService,
          useValue: {
            onActivate: jest.fn((e: Enrolment) => Promise.resolve(e)),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentsService);
    jest.clearAllMocks();
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;

  it('activates draft enrolment and delegates provisioning', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-1',
      status: EnrolmentStatus.DRAFT,
      apprentice: { email: 'app@example.com' },
    } as Enrolment;

    enrolmentFindOne.mockResolvedValue(enrolment);
    enrolmentSave.mockImplementation((value: Enrolment) =>
      Promise.resolve(value),
    );

    const result = await service.activate(user, 'enr-1');
    expect(result.status).toBe(EnrolmentStatus.ACTIVE);
    expect(result.activatedAt).toBeInstanceOf(Date);
  });

  it('accept-provider advances pipeline for provider org', async () => {
    const enrolment = {
      id: 'enr-1',
      organisationId: 'org-employer',
      providerOrganisationId: 'org-provider',
      status: EnrolmentStatus.ACTIVE,
      pipelineState: EnrolmentPipelineState.ACCOUNT_CREATED,
      isDeleted: false,
    } as Enrolment;

    enrolmentFindOne.mockResolvedValue(enrolment);
    pipelineService.isAtLeast.mockReturnValue(true);
    pipelineService.advanceIfAhead.mockResolvedValue({
      ...enrolment,
      pipelineState: EnrolmentPipelineState.PROVIDER_ACCEPTED,
    });

    const result = await service.acceptProvider(
      { id: 'u-2', organisationId: 'org-provider' },
      'enr-1',
    );

    expect(result.pipelineState).toBe(EnrolmentPipelineState.PROVIDER_ACCEPTED);
  });

  it('reject accept-provider from non-provider org', async () => {
    enrolmentFindOne.mockResolvedValue({
      id: 'enr-1',
      organisationId: 'org-employer',
      providerOrganisationId: 'org-provider',
      isDeleted: false,
    });

    await expect(
      service.acceptProvider(
        { id: 'u-2', organisationId: 'org-other' },
        'enr-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

  it('creates draft enrolment', async () => {
    apprenticeFindOne.mockResolvedValue({ id: 'app-1' });
    standardFindOne.mockResolvedValue({ id: 'std-1' });
    enrolmentFindOne.mockResolvedValue(null);
    enrolmentCreate.mockImplementation((v: unknown) => v);
    enrolmentSave.mockImplementation((v: Enrolment) => Promise.resolve(v));

    const result = await service.create(user, {
      apprenticeId: 'app-1',
      standardId: 'std-1',
    });

    expect(result.status).toBe(EnrolmentStatus.DRAFT);
  });

  it('returns paginated enrolments', async () => {
    enrolmentFindAndCount.mockResolvedValue([[{ id: 'enr-1' }], 1]);

    const result = await service.findAll(user, { page: 1, perPage: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('throws not found when enrolment missing', async () => {
    enrolmentFindOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('syncs participants when fields are unset', async () => {
    const enrolment = {
      id: 'enr-1',
      apprenticeUserId: null,
      tutorUserId: null,
      employerManagerUserId: null,
      isDeleted: false,
    } as Enrolment;
    enrolmentFindOne.mockResolvedValue(enrolment);
    enrolmentSave.mockImplementation((v: Enrolment) => Promise.resolve(v));

    const result = await service.syncParticipantsIfUnset('enr-1', {
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-mgr',
    });

    expect(result?.apprenticeUserId).toBe('u-app');
  });

  it('finds enrolment by organisation id', async () => {
    enrolmentFindOne.mockResolvedValue({ id: 'enr-1' });
    await expect(
      service.findByIdForOrganisation('org-1', 'enr-1'),
    ).resolves.toEqual({ id: 'enr-1' });
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
