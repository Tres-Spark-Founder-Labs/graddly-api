import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LevyRecipientProfile } from './entities/levy-recipient-profile.entity.js';
import { LevyRecipientProfileService } from './services/levy-recipient-profile.service.js';

describe('LevyRecipientProfileService', () => {
  let service: LevyRecipientProfileService;

  const profileFindOne = jest.fn();
  const profileCreate = jest.fn();
  const profileSave = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyRecipientProfileService,
        {
          provide: getRepositoryToken(LevyRecipientProfile),
          useValue: {
            findOne: profileFindOne,
            create: profileCreate,
            save: profileSave,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyRecipientProfileService);
    jest.clearAllMocks();
  });

  it('creates a new recipient profile', async () => {
    profileFindOne.mockResolvedValue(null);
    profileCreate.mockImplementation((value: LevyRecipientProfile) => value);
    profileSave.mockImplementation((value: LevyRecipientProfile) =>
      Promise.resolve({
        ...value,
        id: 'profile-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.upsert('org-1', {
      sector: 'Digital & Technology',
      region: 'North West',
      employeeCountBand: '10-49',
      programmeType: 'software_developer',
      transferAmountRequired: '15000.00',
      hasDasAccount: true,
    });

    expect(result.sector).toBe('Digital & Technology');
    expect(result.organisationId).toBe('org-1');
  });

  it('updates an existing recipient profile', async () => {
    const existing: LevyRecipientProfile = {
      id: 'profile-1',
      organisationId: 'org-1',
      sector: 'Construction',
      region: 'London',
      employeeCountBand: '50-249',
      programmeType: 'ST0415 Software Developer',
      transferAmountRequired: '10000.00',
      hasDasAccount: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      isDeleted: false,
      deletedAt: null,
      organisation: {} as never,
    };
    profileFindOne.mockResolvedValue(existing);
    profileSave.mockImplementation((value: LevyRecipientProfile) =>
      Promise.resolve(value),
    );

    const result = await service.upsert('org-1', {
      sector: 'Digital & Technology',
      region: 'North West',
      employeeCountBand: '10-49',
      programmeType: 'software_developer',
      transferAmountRequired: '15000.00',
      hasDasAccount: true,
    });

    expect(result.sector).toBe('Digital & Technology');
    expect(result.region).toBe('North West');
  });

  it('gets recipient profile', async () => {
    profileFindOne.mockResolvedValue({
      id: 'profile-1',
      organisationId: 'org-1',
      sector: 'Digital & Technology',
      region: 'North West',
      employeeCountBand: '10-49',
      programmeType: 'software_developer',
      transferAmountRequired: '15000.00',
      hasDasAccount: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    const result = await service.get('org-1');
    expect(result.id).toBe('profile-1');
  });

  it('throws when profile is missing on get', async () => {
    profileFindOne.mockResolvedValue(null);
    await expect(service.get('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when profile is missing on getEntityOrThrow', async () => {
    profileFindOne.mockResolvedValue(null);
    await expect(service.getEntityOrThrow('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('normalises the open fields as the donor side does, and stores closed ones as sent', async () => {
    profileFindOne.mockResolvedValue(null);
    profileCreate.mockImplementation((value: LevyRecipientProfile) => value);
    profileSave.mockImplementation((value: LevyRecipientProfile) =>
      Promise.resolve({
        ...value,
        id: 'profile-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.upsert('org-1', {
      sector: '  Digital   &  Technology ',
      region: 'North West',
      employeeCountBand: '10-49',
      programmeType: ' ST0415	Software   Developer',
      transferAmountRequired: '15000.00',
      hasDasAccount: false,
    });

    expect(result).toMatchObject({
      sector: 'Digital & Technology',
      region: 'North West',
      employeeCountBand: '10-49',
      programmeType: 'ST0415 Software Developer',
    });
  });
});
