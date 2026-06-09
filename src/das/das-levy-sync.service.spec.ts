import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DasHttpClient } from './das-http.client.js';
import { DasLevySyncService } from './das-levy-sync.service.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasSyncStatus } from './enums/das-sync-status.enum.js';

describe('DasLevySyncService', () => {
  let service: DasLevySyncService;

  const fetchLevyBalance = jest.fn();
  const levyFindOne = jest.fn();
  const levyCreate = jest.fn();
  const levySave = jest.fn();
  const orgFindOne = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasLevySyncService,
        { provide: DasHttpClient, useValue: { fetchLevyBalance } },
        {
          provide: getRepositoryToken(DasLevyBalance),
          useValue: {
            findOne: levyFindOne,
            create: levyCreate,
            save: levySave,
          },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: orgFindOne },
        },
      ],
    }).compile();

    service = moduleRef.get(DasLevySyncService);
    jest.clearAllMocks();
  });

  it('syncs and persists levy balance', async () => {
    orgFindOne.mockResolvedValue({ id: 'org-1', ukprn: '12345678' });
    levyFindOne.mockResolvedValue(null);
    levyCreate.mockImplementation((value: DasLevyBalance) => value);
    fetchLevyBalance.mockResolvedValue({
      accountId: 'acc-1',
      balance: '99.20',
      currency: 'GBP',
      raw: {},
    });
    levySave.mockImplementation((value: DasLevyBalance) =>
      Promise.resolve(value),
    );

    const result = await service.syncOrganisation('org-1', 'user-1');
    expect(result.lastSyncStatus).toBe(DasSyncStatus.SUCCESS);
    expect(result.balance).toBe('99.20');
  });

  it('returns latest levy balance for organisation', async () => {
    levyFindOne.mockResolvedValue({
      organisationId: 'org-1',
      ukprn: '12345678',
      accountId: 'acc-1',
      balance: '50.00',
      currency: 'GBP',
      lastSyncStatus: DasSyncStatus.SUCCESS,
      lastErrorMessage: null,
      lastSyncedAt: new Date('2026-01-01'),
    });

    const result = await service.getLatestForOrganisation('org-1');

    expect(result.balance).toBe('50.00');
    expect(result.organisationId).toBe('org-1');
  });

  it('throws not found when organisation missing', async () => {
    orgFindOne.mockResolvedValue(null);
    await expect(service.syncOrganisation('org-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
