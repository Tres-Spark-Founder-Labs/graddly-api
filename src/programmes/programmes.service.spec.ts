import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Programme } from './entities/programme.entity.js';
import { ProgrammesService } from './programmes.service.js';

describe('ProgrammesService', () => {
  let service: ProgrammesService;

  const findOne = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const findAndCount = jest.fn();
  const softRemove = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProgrammesService,
        {
          provide: getRepositoryToken(Programme),
          useValue: { findOne, create, save, findAndCount, softRemove },
        },
      ],
    }).compile();

    service = moduleRef.get(ProgrammesService);
    jest.clearAllMocks();
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;

  it('creates programme when code is unique', async () => {
    findOne.mockResolvedValue(null);
    create.mockImplementation((value: Programme) => value);
    save.mockImplementation((value: Programme) => Promise.resolve(value));

    const result = await service.create(user, {
      code: 'PROG-1',
      title: 'Programme 1',
    });

    expect(result.code).toBe('PROG-1');
    expect(save).toHaveBeenCalled();
  });

  it('throws conflict when code already exists', async () => {
    findOne.mockResolvedValue({ id: 'p-1', isDeleted: false });

    await expect(
      service.create(user, { code: 'PROG-1', title: 'Programme 1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns paginated programmes', async () => {
    findAndCount.mockResolvedValue([[{ id: 'p-1' }], 1]);

    const result = await service.findAll(user, { page: 1, perPage: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.perPage).toBe(10);
  });

  it('throws not found when programme missing', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates programme fields', async () => {
    const programme = {
      id: 'p-1',
      organisationId: 'org-1',
      code: 'PROG-1',
      title: 'Old',
    } as Programme;
    findOne.mockResolvedValue(programme);
    save.mockImplementation((value: Programme) => Promise.resolve(value));

    const result = await service.update(user, 'p-1', { title: 'New' });

    expect(result.title).toBe('New');
  });

  it('soft-removes programme', async () => {
    const programme = { id: 'p-1', organisationId: 'org-1' } as Programme;
    findOne.mockResolvedValue(programme);
    softRemove.mockResolvedValue(programme);

    await service.remove(user, 'p-1');

    expect(softRemove).toHaveBeenCalledWith(programme);
  });
});
