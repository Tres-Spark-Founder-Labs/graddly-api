import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';

import { LevyMatchApplication } from './entities/levy-match-application.entity.js';
import { LevyMatchApplicationStatus } from './enums/levy-match-application-status.enum.js';
import { LevyMatchApplicationService } from './services/levy-match-application.service.js';
import { LevyTransferPreferenceService } from './services/levy-transfer-preference.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

describe('LevyMatchApplicationService', () => {
  let service: LevyMatchApplicationService;

  const applicationCreate = jest.fn();
  const applicationSave = jest.fn();
  const applicationFindOne = jest.fn();
  const qbGetManyAndCount = jest.fn();
  const qbAndWhere = jest.fn();
  const qbWhere = jest.fn();
  const qbOrderBy = jest.fn();
  const qbSkip = jest.fn();
  const qbTake = jest.fn();

  const getEntityOrThrow = jest.fn();
  const createForUser = jest.fn();
  const membershipFind = jest.fn();

  const recipientUser: AuthenticatedUser = {
    id: 'recipient-user',
    email: 'recipient@example.com',
    organisationId: 'recipient-org',
    roles: ['owner'],
  };

  const donorUser: AuthenticatedUser = {
    id: 'donor-user',
    email: 'donor@example.com',
    organisationId: 'donor-org',
    roles: ['owner'],
  };

  beforeEach(async () => {
    const queryBuilder = {
      where: qbWhere.mockReturnThis(),
      andWhere: qbAndWhere.mockReturnThis(),
      orderBy: qbOrderBy.mockReturnThis(),
      skip: qbSkip.mockReturnThis(),
      take: qbTake.mockReturnThis(),
      getManyAndCount: qbGetManyAndCount,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyMatchApplicationService,
        {
          provide: getRepositoryToken(LevyMatchApplication),
          useValue: {
            create: applicationCreate,
            save: applicationSave,
            findOne: applicationFindOne,
            createQueryBuilder: jest.fn(() => queryBuilder),
          },
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: { find: membershipFind },
        },
        {
          provide: LevyTransferPreferenceService,
          useValue: { getEntityOrThrow },
        },
        {
          provide: NotificationsService,
          useValue: { createForUser },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyMatchApplicationService);
    jest.clearAllMocks();
    membershipFind.mockResolvedValue([]);
    createForUser.mockResolvedValue(undefined);
  });

  it('creates pending application when donor requires review', async () => {
    getEntityOrThrow.mockResolvedValue({ openMatching: false });
    applicationCreate.mockImplementation(
      (value: LevyMatchApplication) => value,
    );
    applicationSave.mockImplementation((value: LevyMatchApplication) =>
      Promise.resolve({
        ...value,
        id: 'app-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }),
    );

    const result = await service.create(recipientUser, {
      donorOrganisationId: 'donor-org',
      requestedAmount: '15000.00',
    });

    expect(result.status).toBe(LevyMatchApplicationStatus.PENDING);
  });

  it('auto-confirms when donor has open matching', async () => {
    getEntityOrThrow.mockResolvedValue({ openMatching: true });
    applicationCreate.mockImplementation(
      (value: LevyMatchApplication) => value,
    );
    applicationSave.mockImplementation((value: LevyMatchApplication) =>
      Promise.resolve({
        ...value,
        id: 'app-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }),
    );

    const result = await service.create(recipientUser, {
      donorOrganisationId: 'donor-org',
      requestedAmount: '15000.00',
    });

    expect(result.status).toBe(LevyMatchApplicationStatus.CONFIRMED);
  });

  it('rejects when recipient and donor are the same org', async () => {
    await expect(
      service.create(
        { ...recipientUser, organisationId: 'same-org' },
        {
          donorOrganisationId: 'same-org',
          requestedAmount: '15000.00',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists applications with pagination meta', async () => {
    qbGetManyAndCount.mockResolvedValue([
      [
        {
          id: 'app-1',
          donorOrganisationId: 'donor-org',
          recipientOrganisationId: 'recipient-org',
          requestedAmount: '15000.00',
          status: LevyMatchApplicationStatus.PENDING,
          matchScore: null,
          scoreBreakdown: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      1,
    ]);

    const result = await service.list('donor-org', { page: 1, perPage: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it('confirms pending application as donor', async () => {
    applicationFindOne.mockResolvedValue({
      id: 'app-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      requestedAmount: '15000.00',
      status: LevyMatchApplicationStatus.PENDING,
      matchScore: null,
      scoreBreakdown: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    applicationSave.mockImplementation((value: LevyMatchApplication) =>
      Promise.resolve(value),
    );

    const result = await service.updateStatus(donorUser, 'app-1', {
      status: LevyMatchApplicationStatus.CONFIRMED,
    });

    expect(result.status).toBe(LevyMatchApplicationStatus.CONFIRMED);
  });

  it('rejects update from recipient organisation', async () => {
    applicationFindOne.mockResolvedValue({
      id: 'app-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      status: LevyMatchApplicationStatus.PENDING,
    });

    await expect(
      service.updateStatus(recipientUser, 'app-1', {
        status: LevyMatchApplicationStatus.CONFIRMED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects update when application is not pending', async () => {
    applicationFindOne.mockResolvedValue({
      id: 'app-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      status: LevyMatchApplicationStatus.CONFIRMED,
    });

    await expect(
      service.updateStatus(donorUser, 'app-1', {
        status: LevyMatchApplicationStatus.REJECTED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when application not found', async () => {
    applicationFindOne.mockResolvedValue(null);
    await expect(
      service.updateStatus(donorUser, 'missing', {
        status: LevyMatchApplicationStatus.CONFIRMED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
