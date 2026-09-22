import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  runWithCorrelationId,
} from '../common/context/correlation-id-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { MatchApplicationRoleFilter } from './dto/list-match-applications-query.dto.js';
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
  const anonymousMatchingByOrganisation = jest.fn();
  const organisationFind = jest.fn();
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
      addOrderBy: jest.fn().mockReturnThis(),
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
          provide: getRepositoryToken(Organisation),
          useValue: { find: organisationFind },
        },
        {
          provide: LevyTransferPreferenceService,
          useValue: { getEntityOrThrow, anonymousMatchingByOrganisation },
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
    anonymousMatchingByOrganisation.mockResolvedValue(new Map());
    organisationFind.mockResolvedValue([]);
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

  /**
   * F4.2.3 AC3 — the donor as the match search showed it: its name, or
   * "Matched donor" when anonymous. An application is still the matching
   * stage, so the rule holds whatever the status. The name sits behind a
   * member-only policy and is read under the bootstrap flag, only for donors
   * that chose to be named.
   */
  describe('how the donor is presented on an application', () => {
    const applicationRow = (
      id: string,
      donorOrganisationId: string,
      status = LevyMatchApplicationStatus.PENDING,
    ) => ({
      id,
      donorOrganisationId,
      recipientOrganisationId: 'recipient-org',
      requestedAmount: '15000.00',
      status,
      matchScore: null,
      scoreBreakdown: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
      runWithCorrelationId({ correlationId: 'match-apps-spec' }, fn);

    it('names a named donor, anonymises an anonymous one, and says nothing without preferences', async () => {
      qbGetManyAndCount.mockResolvedValue([
        [
          applicationRow('app-named', 'donor-named'),
          applicationRow(
            'app-anonymous',
            'donor-anonymous',
            LevyMatchApplicationStatus.CONFIRMED,
          ),
          applicationRow('app-unknown', 'donor-without-preferences'),
        ],
        3,
      ]);
      anonymousMatchingByOrganisation.mockResolvedValue(
        new Map([
          ['donor-named', false],
          ['donor-anonymous', true],
        ]),
      );
      const flagDuringRead: boolean[] = [];
      organisationFind.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve([{ id: 'donor-named', name: 'Acme Ltd' }]);
      });

      await inRequest(async () => {
        const result = await service.list('recipient-org', {
          role: MatchApplicationRoleFilter.RECIPIENT,
          page: 1,
          perPage: 20,
        });

        expect(
          result.items.map((item) => [item.id, item.donorDisplayName]),
        ).toEqual([
          ['app-named', 'Acme Ltd'],
          ['app-anonymous', 'Matched donor'],
          ['app-unknown', null],
        ]);
        expect(flagDuringRead).toEqual([true]);
        expect(getRlsBootstrap()).toBe(false);
      });

      // Only the named donor's label is read, and only the label.
      expect(organisationFind).toHaveBeenCalledTimes(1);
      const [options] = organisationFind.mock.calls[0] as [
        { where: { id: { value: string[] } }; select: string[] },
      ];
      expect(options.select).toEqual(['id', 'name']);
      expect(options.where.id.value).toEqual(['donor-named']);
    });

    it('never reads the name of a donor that matches anonymously', async () => {
      applicationFindOne.mockResolvedValue(
        applicationRow('app-1', 'donor-anonymous'),
      );
      applicationSave.mockImplementation((value: LevyMatchApplication) =>
        Promise.resolve(value),
      );
      anonymousMatchingByOrganisation.mockResolvedValue(
        new Map([['donor-anonymous', true]]),
      );

      const result = await service.updateStatus(
        { ...donorUser, organisationId: 'donor-anonymous' },
        'app-1',
        { status: LevyMatchApplicationStatus.CONFIRMED },
      );

      expect(result.donorDisplayName).toBe('Matched donor');
      expect(organisationFind).not.toHaveBeenCalled();
    });
  });
});
