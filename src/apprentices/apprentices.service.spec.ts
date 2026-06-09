import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApprenticesService,
        {
          provide: getRepositoryToken(Apprentice),
          useValue: { findOne, create, save, findAndCount, softRemove },
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
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;

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
    findAndCount.mockResolvedValue([[{ id: 'a-1' }], 1]);
    const result = await service.findAll(user, { page: 2, perPage: 5 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.page).toBe(2);
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
