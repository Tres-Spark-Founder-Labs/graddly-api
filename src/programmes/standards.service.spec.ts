import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Programme } from './entities/programme.entity.js';
import { Standard } from './entities/standard.entity.js';
import { StandardsService } from './standards.service.js';

describe('StandardsService', () => {
  let service: StandardsService;

  const standardFindOne = jest.fn();
  const standardCreate = jest.fn();
  const standardSave = jest.fn();
  const standardFindAndCount = jest.fn();
  const standardSoftRemove = jest.fn();
  const programmeFindOne = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StandardsService,
        {
          provide: getRepositoryToken(Standard),
          useValue: {
            findOne: standardFindOne,
            create: standardCreate,
            save: standardSave,
            findAndCount: standardFindAndCount,
            softRemove: standardSoftRemove,
          },
        },
        {
          provide: getRepositoryToken(Programme),
          useValue: { findOne: programmeFindOne },
        },
      ],
    }).compile();

    service = moduleRef.get(StandardsService);
    jest.clearAllMocks();
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;

  it('creates standard when programme exists and code unique', async () => {
    programmeFindOne.mockResolvedValue({ id: 'prog-1' });
    standardFindOne.mockResolvedValue(null);
    standardCreate.mockImplementation((value: Standard) => value);
    standardSave.mockImplementation((value: Standard) =>
      Promise.resolve(value),
    );

    const result = await service.create(user, {
      programmeId: 'prog-1',
      code: 'STD-1',
      title: 'Standard 1',
    });

    expect(result.programmeId).toBe('prog-1');
    expect(standardSave).toHaveBeenCalled();
  });

  it('throws not found when programme missing', async () => {
    programmeFindOne.mockResolvedValue(null);

    await expect(
      service.create(user, {
        programmeId: 'missing',
        code: 'STD-1',
        title: 'Standard 1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws conflict when standard code exists', async () => {
    programmeFindOne.mockResolvedValue({ id: 'prog-1' });
    standardFindOne.mockResolvedValue({ id: 'std-1', isDeleted: false });

    await expect(
      service.create(user, {
        programmeId: 'prog-1',
        code: 'STD-1',
        title: 'Standard 1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns paginated standards', async () => {
    standardFindAndCount.mockResolvedValue([[{ id: 'std-1' }], 1]);

    const result = await service.findAll(user, { page: 1, perPage: 5 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.perPage).toBe(5);
  });

  it('returns standard when found', async () => {
    const standard = { id: 'std-1', organisationId: 'org-1' } as Standard;
    standardFindOne.mockResolvedValue(standard);

    await expect(service.findOne(user, 'std-1')).resolves.toEqual(standard);
  });

  it('updates standard fields', async () => {
    const standard = {
      id: 'std-1',
      organisationId: 'org-1',
      programmeId: 'prog-1',
      code: 'STD-1',
      title: 'Old',
    } as Standard;
    standardFindOne.mockResolvedValue(standard);
    standardSave.mockImplementation((value: Standard) =>
      Promise.resolve(value),
    );

    const result = await service.update(user, 'std-1', { title: 'New' });

    expect(result.title).toBe('New');
  });

  it('soft-removes standard', async () => {
    const standard = { id: 'std-1', organisationId: 'org-1' } as Standard;
    standardFindOne.mockResolvedValue(standard);
    standardSoftRemove.mockResolvedValue(standard);

    await service.remove(user, 'std-1');

    expect(standardSoftRemove).toHaveBeenCalledWith(standard);
  });
});
