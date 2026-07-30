import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LevyRecipientProfile } from './entities/levy-recipient-profile.entity.js';
import { LevyRecipientProfileService } from './services/levy-recipient-profile.service.js';

const qbWhere = jest.fn().mockReturnThis();
const qbAndWhere = jest.fn().mockReturnThis();
const qbOrderBy = jest.fn().mockReturnThis();
const qbSkip = jest.fn().mockReturnThis();
const qbTake = jest.fn().mockReturnThis();
const qbGetManyAndCount = jest.fn();

const queryBuilder = {
  where: qbWhere,
  andWhere: qbAndWhere,
  orderBy: qbOrderBy,
  skip: qbSkip,
  take: qbTake,
  getManyAndCount: qbGetManyAndCount,
};

const profileRepo = {
  createQueryBuilder: jest.fn(() => queryBuilder),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const row = (overrides: Partial<LevyRecipientProfile> = {}) =>
  ({
    id: 'profile-1',
    organisationId: 'org-sme',
    sector: 'Manufacturing',
    region: 'West Midlands',
    employeeCountBand: '10-49',
    programmeType: 'standards',
    transferAmountRequired: '15000.00',
    hasDasAccount: true,
    isListed: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  }) as LevyRecipientProfile;

describe('LevyRecipientProfileService — directory (F1.1.4 AC2)', () => {
  let service: LevyRecipientProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    qbGetManyAndCount.mockResolvedValue([[row()], 1]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LevyRecipientProfileService,
        {
          provide: getRepositoryToken(LevyRecipientProfile),
          useValue: profileRepo,
        },
      ],
    }).compile();

    service = module.get(LevyRecipientProfileService);
  });

  it('returns only profiles that opted in to the directory', async () => {
    await service.searchDirectory('org-donor', { page: 1, perPage: 20 });
    expect(qbWhere).toHaveBeenCalledWith('p.isListed = true');
  });

  it('excludes the caller’s own organisation from results', async () => {
    await service.searchDirectory('org-donor', { page: 1, perPage: 20 });
    expect(qbAndWhere).toHaveBeenCalledWith(
      'p.organisationId != :viewerOrganisationId',
      { viewerOrganisationId: 'org-donor' },
    );
  });

  it('applies sector, region and programme filters when supplied', async () => {
    await service.searchDirectory('org-donor', {
      page: 1,
      perPage: 20,
      sector: 'Manufacturing',
      region: 'West Midlands',
      programmeType: 'standards',
    });

    const clauses = (qbAndWhere.mock.calls as unknown as [string][]).map(
      (c) => c[0],
    );
    expect(clauses).toEqual(
      expect.arrayContaining([
        'LOWER(p.sector) = LOWER(:sector)',
        'LOWER(p.region) = LOWER(:region)',
        'LOWER(p.programmeType) = LOWER(:programmeType)',
      ]),
    );
  });

  it('omits filters that were not supplied, so the directory can be browsed', async () => {
    await service.searchDirectory('org-donor', { page: 1, perPage: 20 });
    const clauses = (qbAndWhere.mock.calls as unknown as [string][]).map(
      (c) => c[0],
    );
    expect(clauses).not.toContain('LOWER(p.sector) = LOWER(:sector)');
  });

  it('matches filters case-insensitively', async () => {
    // Sector/region are free text captured from SME onboarding, so casing
    // varies; an exact match would silently return nothing.
    await service.searchDirectory('org-donor', {
      page: 1,
      perPage: 20,
      sector: 'manufacturing',
    });
    expect(qbAndWhere).toHaveBeenCalledWith(
      'LOWER(p.sector) = LOWER(:sector)',
      { sector: 'manufacturing' },
    );
  });

  it('paginates and reports meta', async () => {
    qbGetManyAndCount.mockResolvedValue([[row()], 42]);
    const result = await service.searchDirectory('org-donor', {
      page: 2,
      perPage: 20,
    });

    expect(qbSkip).toHaveBeenCalledWith(20);
    expect(qbTake).toHaveBeenCalledWith(20);
    expect(result.meta.total).toBe(42);
    expect(result.meta.page).toBe(2);
  });

  it('exposes isListed on the mapped response', async () => {
    const result = await service.searchDirectory('org-donor', {
      page: 1,
      perPage: 20,
    });
    expect(result.items[0]).toMatchObject({
      organisationId: 'org-sme',
      sector: 'Manufacturing',
      isListed: true,
    });
  });
});

describe('LevyRecipientProfileService — listing opt-in', () => {
  let service: LevyRecipientProfileService;

  const baseDto = {
    sector: 'Manufacturing',
    region: 'West Midlands',
    employeeCountBand: '10-49',
    programmeType: 'standards',
    transferAmountRequired: '15000.00',
    hasDasAccount: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    profileRepo.save.mockImplementation((e: LevyRecipientProfile) =>
      Promise.resolve({
        ...row(),
        ...e,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      }),
    );
    profileRepo.create.mockImplementation(
      (e: Partial<LevyRecipientProfile>) => e,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LevyRecipientProfileService,
        {
          provide: getRepositoryToken(LevyRecipientProfile),
          useValue: profileRepo,
        },
      ],
    }).compile();

    service = module.get(LevyRecipientProfileService);
  });

  it('creates profiles unlisted by default', async () => {
    // Privacy default: an SME must choose to be discoverable.
    profileRepo.findOne.mockResolvedValue(null);
    await service.upsert('org-sme', baseDto);
    expect(profileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isListed: false }),
    );
  });

  it('honours an explicit opt-in on create', async () => {
    profileRepo.findOne.mockResolvedValue(null);
    await service.upsert('org-sme', { ...baseDto, isListed: true });
    expect(profileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isListed: true }),
    );
  });

  it('does not un-list a profile when the field is omitted on update', async () => {
    // An unrelated edit (say, changing region) must not silently remove the
    // SME from the directory.
    const existing = row({ isListed: true });
    profileRepo.findOne.mockResolvedValue(existing);

    await service.upsert('org-sme', { ...baseDto, region: 'North West' });

    expect(profileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isListed: true, region: 'North West' }),
    );
  });

  it('allows explicitly opting back out', async () => {
    profileRepo.findOne.mockResolvedValue(row({ isListed: true }));
    await service.upsert('org-sme', { ...baseDto, isListed: false });
    expect(profileRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isListed: false }),
    );
  });
});
