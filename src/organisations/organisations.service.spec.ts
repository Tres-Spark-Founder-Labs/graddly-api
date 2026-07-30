import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { OrganisationMembership } from './entities/organisation-membership.entity.js';
import { Organisation } from './entities/organisation.entity.js';
import { MembershipStatus } from './membership-status.enum.js';
import { OrganisationRole } from './organisation-role.enum.js';
import { OrganisationsService } from './organisations.service.js';

const baseOrgDto = {
  name: 'Acme Trust',
  ukprn: '10012345',
  address: '1 Training Lane',
  city: 'London',
  postcode: 'SW1A 1AA',
  country: 'United Kingdom',
  orgEmail: 'info@acme.co.uk',
} as const;

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('OrganisationsService', () => {
  let service: OrganisationsService;
  let repository: jest.Mocked<
    Pick<
      Repository<Organisation>,
      'find' | 'findOne' | 'save' | 'softRemove'
    > & {
      createQueryBuilder: jest.Mock;
    }
  >;
  let membershipRepository: jest.Mocked<
    Pick<Repository<OrganisationMembership>, 'create' | 'save' | 'findOne'>
  >;
  let mockManager: jest.Mocked<
    Pick<EntityManager, 'create' | 'save' | 'query'>
  >;
  const randomUuidMock = jest.mocked(randomUUID);
  let mockDataSource: { transaction: jest.Mock };
  let mockQueryBuilder: {
    select: jest.Mock;
    where: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    membershipRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    mockManager = {
      create: jest.fn(),
      save: jest.fn(),
      query: jest.fn().mockResolvedValue(undefined),
    };

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation(
          (cb: (manager: typeof mockManager) => Promise<unknown>) =>
            cb(mockManager),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganisationsService,
        { provide: getRepositoryToken(Organisation), useValue: repository },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepository,
        },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(OrganisationsService);
  });

  describe('create', () => {
    it('auto-generates slug from name and creates org + membership in a transaction', async () => {
      randomUuidMock.mockReturnValue('org-1');
      mockQueryBuilder.getMany.mockResolvedValue([]);
      repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'org-1',
        name: 'Acme Trust',
        slug: 'acme-trust',
      } as Organisation);

      const membershipEntity = {} as OrganisationMembership;
      mockManager.create.mockReturnValue(membershipEntity as never);
      mockManager.save.mockResolvedValue(membershipEntity);

      const result = await service.create(baseOrgDto, 'user-1');

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organisations'),
        [
          'org-1',
          'Acme Trust',
          'acme-trust',
          null,
          '10012345',
          '1 Training Lane',
          'London',
          'SW1A 1AA',
          'United Kingdom',
          'info@acme.co.uk',
          null,
          null,
          null,
        ],
      );
      expect(mockManager.create).toHaveBeenCalledWith(
        OrganisationMembership,
        expect.objectContaining({
          user: { id: 'user-1' },
          organisation: { id: 'org-1' },
          role: OrganisationRole.OWNER,
          status: MembershipStatus.ACTIVE,
        }),
      );
      const membershipCreatePayload = mockManager.create.mock.calls[0]?.[1] as
        | Partial<OrganisationMembership>
        | undefined;
      expect(membershipCreatePayload?.joinedAt).toBeInstanceOf(Date);
      expect(mockManager.save).toHaveBeenCalledTimes(1);
      expect(mockManager.save).toHaveBeenCalledWith(membershipEntity);
      expect(result).toEqual({
        id: 'org-1',
        name: 'Acme Trust',
        slug: 'acme-trust',
      });
    });

    it('appends numeric suffix when generated slug is already taken', async () => {
      randomUuidMock.mockReturnValue('org-2');
      mockQueryBuilder.getMany.mockResolvedValue([
        { slug: 'acme-trust' },
        { slug: 'acme-trust-1' },
      ] as Organisation[]);
      repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'org-2',
        name: 'Acme Trust',
        slug: 'acme-trust-2',
      } as Organisation);

      mockManager.create.mockReturnValue({} as never);
      mockManager.save.mockResolvedValue({});

      const result = await service.create(baseOrgDto, 'user-1');

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organisations'),
        expect.arrayContaining(['org-2', 'Acme Trust', 'acme-trust-2']),
      );
      expect(result).toEqual({
        id: 'org-2',
        name: 'Acme Trust',
        slug: 'acme-trust-2',
      });
    });

    it('throws ConflictException when UKPRN belongs to another org', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);
      repository.findOne.mockResolvedValueOnce({ id: 'other' } as Organisation);

      await expect(service.create(baseOrgDto, 'user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('propagates error and rolls back when membership insert fails', async () => {
      randomUuidMock.mockReturnValue('org-1');
      mockQueryBuilder.getMany.mockResolvedValue([]);
      repository.findOne.mockResolvedValueOnce(null);

      mockManager.create.mockReturnValue({} as never);
      mockManager.save.mockRejectedValue(new Error('DB constraint violation'));

      await expect(service.create(baseOrgDto, 'user-1')).rejects.toThrow(
        'DB constraint violation',
      );
      expect(mockManager.query).toHaveBeenCalledTimes(1);
      expect(mockManager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('returns organisation when found', async () => {
      const org = { id: 'org-1', name: 'A', slug: 'a' } as Organisation;
      repository.findOne.mockResolvedValueOnce(org);
      await expect(service.findOne('org-1')).resolves.toEqual(org);
    });

    it('throws NotFoundException when missing', async () => {
      repository.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it("throws ForbiddenException when :id does not match the caller's active organisation", async () => {
      await expect(
        service.update('org-1', { name: 'New Name' }, 'org-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws ConflictException when new UKPRN belongs to another org', async () => {
      const existing = {
        id: 'org-1',
        name: 'A',
        slug: 'a',
        ukprn: '11111111',
      } as Organisation;
      const other = { id: 'org-2', ukprn: '22222222' } as Organisation;
      repository.findOne
        .mockResolvedValueOnce(existing) // findOne in findOne()
        .mockResolvedValueOnce(other); //   UKPRN clash check

      await expect(
        service.update('org-1', { ukprn: '22222222' }, 'org-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates fields when payload is valid', async () => {
      const existing = {
        id: 'org-1',
        name: 'Old Name',
        slug: 'old-name',
        city: 'Manchester',
      } as Organisation;
      repository.findOne.mockResolvedValueOnce(existing);
      repository.save.mockImplementation((o: Organisation) =>
        Promise.resolve(o),
      );

      const result = await service.update(
        'org-1',
        { name: 'New Name', city: 'London' },
        'org-1',
      );

      expect(result.name).toBe('New Name');
      expect(result.city).toBe('London');
      expect(result.slug).toBe('old-name'); // slug unchanged
    });

    it('sets logoUrl when provided and clears it on empty string', async () => {
      const existing = {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        logoUrl: null,
      } as Organisation;
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockImplementation((o: Organisation) =>
        Promise.resolve(o),
      );

      const set = await service.update(
        'org-1',
        { logoUrl: 'https://cdn.example.com/logo.png' },
        'org-1',
      );
      expect(set.logoUrl).toBe('https://cdn.example.com/logo.png');

      const cleared = await service.update('org-1', { logoUrl: '' }, 'org-1');
      expect(cleared.logoUrl).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns organisations ordered by createdAt desc', async () => {
      const orgs = [
        { id: 'org-2', name: 'B', slug: 'b' },
        { id: 'org-1', name: 'A', slug: 'a' },
      ] as Organisation[];
      repository.find.mockResolvedValueOnce(orgs);

      await expect(service.findAll()).resolves.toEqual(orgs);
      expect(repository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('remove', () => {
    it("throws ForbiddenException when :id does not match the caller's active organisation", async () => {
      await expect(service.remove('org-1', 'org-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('soft-removes organisation', async () => {
      const org = { id: 'org-1', name: 'A', slug: 'a' } as Organisation;
      repository.findOne.mockResolvedValueOnce(org);
      repository.softRemove.mockResolvedValueOnce(org);

      await service.remove('org-1', 'org-1');

      expect(repository.softRemove).toHaveBeenCalledWith(org);
    });
  });
});
