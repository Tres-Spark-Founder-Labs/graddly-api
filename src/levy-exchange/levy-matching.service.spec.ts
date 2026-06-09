import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { LevyRecipientProfile } from './entities/levy-recipient-profile.entity.js';
import { LevyTransferPreference } from './entities/levy-transfer-preference.entity.js';
import { LevyWaitingPoolEntry } from './entities/levy-waiting-pool-entry.entity.js';
import { LevyMatchingService } from './services/levy-matching.service.js';
import { LevyRecipientProfileService } from './services/levy-recipient-profile.service.js';
import { LevySurplusService } from './services/levy-surplus.service.js';
import { LevyTransferPreferenceService } from './services/levy-transfer-preference.service.js';

describe('LevyMatchingService', () => {
  let service: LevyMatchingService;

  const getEntityOrThrow = jest.fn();
  const findAllActive = jest.fn();
  const getLatestForOrganisations = jest.fn();
  const compareAmounts = jest.fn(
    (left: string, right: string) =>
      Number.parseFloat(left) - Number.parseFloat(right),
  );
  const minAmount = jest.fn((left: string, right: string) =>
    compareAmounts(left, right) <= 0 ? left : right,
  );

  const organisationFind = jest.fn();
  const waitingPoolFindOne = jest.fn();
  const waitingPoolCreate = jest.fn();
  const waitingPoolSave = jest.fn();

  const recipientProfile: LevyRecipientProfile = {
    id: 'profile-1',
    organisationId: 'recipient-org',
    sector: 'construction',
    region: 'north_west',
    employeeCountBand: '10_49',
    programmeType: 'standards',
    transferAmountRequired: '15000.00',
    hasDasAccount: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    organisation: {} as never,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyMatchingService,
        {
          provide: LevyRecipientProfileService,
          useValue: { getEntityOrThrow },
        },
        {
          provide: LevyTransferPreferenceService,
          useValue: { findAllActive },
        },
        {
          provide: LevySurplusService,
          useValue: {
            getLatestForOrganisations,
            compareAmounts,
            minAmount,
          },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { find: organisationFind },
        },
        {
          provide: getRepositoryToken(LevyWaitingPoolEntry),
          useValue: {
            findOne: waitingPoolFindOne,
            create: waitingPoolCreate,
            save: waitingPoolSave,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyMatchingService);
    jest.clearAllMocks();
  });

  it('throws when recipient profile is missing', async () => {
    getEntityOrThrow.mockRejectedValue(
      new NotFoundException('Recipient profile not found'),
    );

    await expect(service.searchMatches('recipient-org')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('scores and ranks eligible donors', async () => {
    getEntityOrThrow.mockResolvedValue(recipientProfile);
    findAllActive.mockResolvedValue([
      {
        organisationId: 'donor-a',
        sectors: ['construction'],
        regions: ['north_west'],
        sizeBands: ['10_49'],
        programmeTypes: ['standards'],
        maxPerRecipient: null,
        openMatching: false,
        anonymousMatching: false,
      },
      {
        organisationId: 'donor-b',
        sectors: ['retail'],
        regions: ['london'],
        sizeBands: ['50_249'],
        programmeTypes: ['frameworks'],
        maxPerRecipient: null,
        openMatching: false,
        anonymousMatching: true,
      },
      {
        organisationId: 'recipient-org',
        sectors: [],
        regions: [],
        sizeBands: [],
        programmeTypes: [],
        maxPerRecipient: null,
        openMatching: true,
        anonymousMatching: false,
      },
    ] satisfies Partial<LevyTransferPreference>[]);
    getLatestForOrganisations.mockResolvedValue(
      new Map([
        [
          'donor-a',
          {
            organisationId: 'donor-a',
            availableSurplus: '50000.00',
            computedAt: new Date(),
          },
        ],
        [
          'donor-b',
          {
            organisationId: 'donor-b',
            availableSurplus: '50000.00',
            computedAt: new Date(),
          },
        ],
      ]),
    );
    organisationFind.mockResolvedValue([
      { id: 'donor-a', name: 'Donor A Ltd', isDeleted: false },
    ]);

    const result = await service.searchMatches('recipient-org');

    expect(result.addedToWaitingPool).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.donorOrganisationId).toBe('donor-a');
    expect(result.matches[0]?.donorDisplayName).toBe('Donor A Ltd');
    expect(
      Number.parseFloat(result.matches[0]?.matchScore ?? '0'),
    ).toBeGreaterThan(40);
  });

  it('adds recipient to waiting pool when no matches are found', async () => {
    getEntityOrThrow.mockResolvedValue(recipientProfile);
    findAllActive.mockResolvedValue([]);
    getLatestForOrganisations.mockResolvedValue(new Map());
    organisationFind.mockResolvedValue([]);
    waitingPoolFindOne.mockResolvedValue(null);
    waitingPoolCreate.mockImplementation(
      (value: LevyWaitingPoolEntry) => value,
    );
    waitingPoolSave.mockImplementation((value: LevyWaitingPoolEntry) =>
      Promise.resolve(value),
    );

    const result = await service.searchMatches('recipient-org');

    expect(result.matches).toHaveLength(0);
    expect(result.addedToWaitingPool).toBe(true);
    expect(waitingPoolSave).toHaveBeenCalled();
  });

  it('masks donor display name when anonymous matching is enabled', async () => {
    getEntityOrThrow.mockResolvedValue(recipientProfile);
    findAllActive.mockResolvedValue([
      {
        organisationId: 'donor-anon',
        sectors: ['construction'],
        regions: ['north_west'],
        sizeBands: ['10_49'],
        programmeTypes: ['standards'],
        maxPerRecipient: null,
        openMatching: false,
        anonymousMatching: true,
      },
    ]);
    getLatestForOrganisations.mockResolvedValue(
      new Map([
        [
          'donor-anon',
          {
            organisationId: 'donor-anon',
            availableSurplus: '50000.00',
            computedAt: new Date(),
          },
        ],
      ]),
    );
    organisationFind.mockResolvedValue([
      { id: 'donor-anon', name: 'Secret Donor Ltd', isDeleted: false },
    ]);

    const result = await service.searchMatches('recipient-org');
    expect(result.matches[0]?.donorDisplayName).toBe('Matched donor');
  });

  it('caps transferable amount by donor maxPerRecipient', async () => {
    getEntityOrThrow.mockResolvedValue({
      ...recipientProfile,
      transferAmountRequired: '20000.00',
    });
    findAllActive.mockResolvedValue([
      {
        organisationId: 'donor-a',
        sectors: ['construction'],
        regions: ['north_west'],
        sizeBands: ['10_49'],
        programmeTypes: ['standards'],
        maxPerRecipient: '10000.00',
        openMatching: false,
        anonymousMatching: false,
      },
    ]);
    getLatestForOrganisations.mockResolvedValue(
      new Map([
        [
          'donor-a',
          {
            organisationId: 'donor-a',
            availableSurplus: '50000.00',
            computedAt: new Date(),
          },
        ],
      ]),
    );
    organisationFind.mockResolvedValue([
      { id: 'donor-a', name: 'Donor A Ltd', isDeleted: false },
    ]);

    const result = await service.searchMatches('recipient-org');
    expect(result.matches[0]?.transferableAmount).toBe('10000.00');
  });
});
