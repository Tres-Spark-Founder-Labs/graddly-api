import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { testAuthenticatedUser } from '../auth/testing/authenticated-user.fixture.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { ApprenticesService } from './apprentices.service.js';
import { Apprentice } from './entities/apprentice.entity.js';

describe('ApprenticesService', () => {
  let service: ApprenticesService;

  const findOne = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const findAndCount = jest.fn();
  const softRemove = jest.fn();
  const getManyAndCount = jest.fn();
  const orgFindOne = jest.fn();

  /**
   * findAll builds its query rather than passing an object literal, because
   * the employer branch needs an EXISTS over enrolments. The double mirrors
   * the chain rather than the old findAndCount call.
   */
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount,
  };
  const createQueryBuilder = jest.fn(() => queryBuilder);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprenticesService,
        {
          provide: getRepositoryToken(Apprentice),
          useValue: {
            findOne,
            create,
            save,
            findAndCount,
            softRemove,
            createQueryBuilder,
          },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: orgFindOne },
        },
        {
          provide: WithdrawalPushService,
          useValue: {
            queueFromApprenticeWithdrawal: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ApprenticesService);
    jest.clearAllMocks();
    // Default to a provider caller, which is the behaviour that existed before
    // the employer branch was added.
    orgFindOne.mockResolvedValue({
      id: 'org-1',
      portalType: PortalType.PROVIDER,
    });
  });

  const user = testAuthenticatedUser({ id: 'u-1', organisationId: 'org-1' });

  it('creates apprentice with normalized email', async () => {
    findOne.mockResolvedValue(null);
    create.mockImplementation((value: Apprentice) => value);
    save.mockImplementation((value: Apprentice) => Promise.resolve(value));

    const result = await service.create(user, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ADA@EXAMPLE.COM',
    });

    expect(result.email).toBe('ada@example.com');
  });

  it('throws conflict when apprentice email exists', async () => {
    findOne.mockResolvedValue({ id: 'a-1', isDeleted: false });

    await expect(
      service.create(user, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns paginated apprentices', async () => {
    getManyAndCount.mockResolvedValue([[{ id: 'a-1' }], 1]);
    const result = await service.findAll(user, { page: 2, perPage: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.page).toBe(2);
  });

  it('scopes a provider to the apprentices it owns', async () => {
    getManyAndCount.mockResolvedValue([[], 0]);
    await service.findAll(user, { page: 1, perPage: 20 });

    const clauses = (queryBuilder.andWhere.mock.calls as unknown[][]).map((c) =>
      String(c[0]),
    );
    expect(clauses.some((c) => c.includes('apprentice.organisationId'))).toBe(
      true,
    );
    // A provider must not pick up learners through someone else's enrolment.
    expect(clauses.some((c) => c.includes('EXISTS'))).toBe(false);
  });

  it('derives an employer roster from enrolments where they are the employer', async () => {
    orgFindOne.mockResolvedValue({
      id: 'org-1',
      portalType: PortalType.EMPLOYER,
    });
    getManyAndCount.mockResolvedValue([[], 0]);
    await service.findAll(user, { page: 1, perPage: 20 });

    const clauses = (queryBuilder.andWhere.mock.calls as unknown[][]).map((c) =>
      String(c[0]),
    );
    const exists = clauses.find((c) => c.includes('EXISTS'));

    expect(exists).toBeDefined();
    // The employer side only. Matching providerOrganisationId here would let an
    // employer read a provider's whole book through their own roster.
    expect(exists).toContain('employerOrganisationId');
    expect(exists).not.toContain('providerOrganisationId');
    // Ownership must not be ORed back in, or the branch is pointless.
    expect(clauses.some((c) => c.includes('apprentice.organisationId'))).toBe(
      false,
    );
  });

  it('throws not found when apprentice missing', async () => {
    findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates apprentice fields', async () => {
    const apprentice = {
      id: 'a-1',
      organisationId: 'org-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      status: 'active',
    } as Apprentice;
    findOne.mockResolvedValue(apprentice);
    save.mockImplementation((value: Apprentice) => Promise.resolve(value));

    const result = await service.update(user, 'a-1', {
      firstName: 'Augusta',
    });

    expect(result.firstName).toBe('Augusta');
  });

  it('soft-removes apprentice', async () => {
    const apprentice = { id: 'a-1', organisationId: 'org-1' } as Apprentice;
    findOne.mockResolvedValue(apprentice);
    softRemove.mockResolvedValue(apprentice);

    await service.remove(user, 'a-1');

    expect(softRemove).toHaveBeenCalledWith(apprentice);
  });
});
