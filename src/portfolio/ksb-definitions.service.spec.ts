import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Standard } from '../programmes/entities/standard.entity.js';

import { KsbDefinition } from './entities/ksb-definition.entity.js';
import { KsbKind } from './enums/ksb-kind.enum.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';

describe('KsbDefinitionsService', () => {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: { id?: string }) => ({ id: 'ksb-1', ...v })),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const standardRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'std-1' }),
  };

  let service: KsbDefinitionsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        KsbDefinitionsService,
        { provide: getRepositoryToken(KsbDefinition), useValue: repo },
        { provide: getRepositoryToken(Standard), useValue: standardRepo },
      ],
    }).compile();
    service = moduleRef.get(KsbDefinitionsService);
    jest.clearAllMocks();
    standardRepo.findOne.mockResolvedValue({ id: 'std-1' });
    repo.findOne.mockResolvedValue(null);
  });

  const user = {
    id: 'u1',
    organisationId: 'org-1',
    email: 'a@example.com',
    roles: ['owner'],
  } as const;

  it('creates a KSB definition', async () => {
    const result = await service.createForStandard(user, 'std-1', {
      code: 'K1',
      kind: KsbKind.KNOWLEDGE,
      title: 'Knowledge 1',
    });
    expect(result.code).toBe('K1');
    expect(repo.save).toHaveBeenCalled();
  });

  it('rejects duplicate code', async () => {
    repo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createForStandard(user, 'std-1', {
        code: 'K1',
        kind: KsbKind.KNOWLEDGE,
        title: 'Dup',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists KSB definitions for a standard', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'ksb-1',
        organisationId: 'org-1',
        standardId: 'std-1',
        code: 'K1',
        kind: KsbKind.KNOWLEDGE,
        title: 'Knowledge 1',
        description: null,
        sortOrder: 0,
      },
    ]);

    const result = await service.findByStandard(user, 'std-1');

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('K1');
  });

  it('updates KSB definition', async () => {
    repo.findOne.mockResolvedValue({
      id: 'ksb-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      code: 'K1',
      kind: KsbKind.KNOWLEDGE,
      title: 'Old',
      isDeleted: false,
    });
    repo.save.mockImplementation((v: KsbDefinition) => Promise.resolve(v));

    const result = await service.update(user, 'ksb-1', { title: 'New' });

    expect(result.title).toBe('New');
  });

  it('soft-deletes KSB definition', async () => {
    const row = {
      id: 'ksb-1',
      organisationId: 'org-1',
      isDeleted: false,
    } as KsbDefinition;
    repo.findOne.mockResolvedValue(row);
    repo.save.mockImplementation((v: KsbDefinition) => Promise.resolve(v));

    await service.remove(user, 'ksb-1');

    expect(row.isDeleted).toBe(true);
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it('finds entity by id', async () => {
    const row = { id: 'ksb-1', organisationId: 'org-1' } as KsbDefinition;
    repo.findOne.mockResolvedValue(row);

    await expect(service.findEntity(user, 'ksb-1')).resolves.toEqual(row);
  });

  it('finds entities for standard', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'ksb-1' }]),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const rows = await service.findEntitiesForStandard('org-1', 'std-1', [
      'ksb-1',
    ]);

    expect(rows).toHaveLength(1);
  });

  it('finds responses by ids', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'ksb-1',
        organisationId: 'org-1',
        standardId: 'std-1',
        code: 'K1',
        kind: KsbKind.KNOWLEDGE,
        title: 'K1',
        description: null,
        sortOrder: 0,
      },
    ]);

    const result = await service.findResponsesByIds('org-1', ['ksb-1']);

    expect(result).toHaveLength(1);
  });

  it('maps entity to response DTO', () => {
    const response = service.toResponse({
      id: 'ksb-1',
      organisationId: 'org-1',
      standardId: 'std-1',
      code: 'K1',
      kind: KsbKind.KNOWLEDGE,
      title: 'Knowledge 1',
      description: null,
      sortOrder: 0,
    } as KsbDefinition);

    expect(response.code).toBe('K1');
  });
});
