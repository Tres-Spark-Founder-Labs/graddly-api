import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';

import { DasDonorLink } from './entities/das-donor-link.entity.js';
import { DasLevyTranche } from './entities/das-levy-tranche.entity.js';
import { LevySurplusSnapshot } from './entities/levy-surplus-snapshot.entity.js';
import { LevyTransfer } from './entities/levy-transfer.entity.js';
import { DasDonorLinkStatus } from './enums/das-donor-link-status.enum.js';
import { LevyTransferStatus } from './enums/levy-transfer-status.enum.js';
import { LevySurplusService } from './services/levy-surplus.service.js';

describe('LevySurplusService', () => {
  let service: LevySurplusService;

  const donorLinkFind = jest.fn();
  const trancheFind = jest.fn();
  const snapshotFind = jest.fn();
  const snapshotFindOne = jest.fn();
  const snapshotCreate = jest.fn();
  const snapshotSave = jest.fn();
  const snapshotGetMany = jest.fn();
  const transferFind = jest.fn();
  const forecastForOrganisation = jest.fn();

  beforeEach(async () => {
    const queryBuilder = {
      distinctOn: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: snapshotGetMany,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LevySurplusService,
        {
          provide: DasLevyForecastService,
          useValue: { forecastForOrganisation },
        },
        {
          provide: getRepositoryToken(DasDonorLink),
          useValue: { find: donorLinkFind },
        },
        {
          provide: getRepositoryToken(DasLevyTranche),
          useValue: { find: trancheFind },
        },
        {
          provide: getRepositoryToken(LevySurplusSnapshot),
          useValue: {
            find: snapshotFind,
            findOne: snapshotFindOne,
            create: snapshotCreate,
            save: snapshotSave,
            createQueryBuilder: jest.fn(() => queryBuilder),
          },
        },
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: { find: transferFind },
        },
      ],
    }).compile();

    service = moduleRef.get(LevySurplusService);
    jest.clearAllMocks();
  });

  it('returns empty surplus when no linked donor accounts exist', async () => {
    donorLinkFind.mockResolvedValue([]);
    await expect(service.getSurplus('org-1')).resolves.toEqual([]);
  });

  it('recomputes surplus with 50% cap and subtracts already transferred', async () => {
    donorLinkFind.mockResolvedValue([
      {
        id: 'link-1',
        organisationId: 'org-1',
        label: 'Group Ltd',
        status: DasDonorLinkStatus.LINKED,
        lastBalance: '10000.00',
      },
    ]);
    forecastForOrganisation.mockResolvedValue({
      organisationId: 'org-1',
      horizonMonths: 12,
      projectedMonthlySpend: 100,
      projectedCompletionLiability: 500,
    });
    transferFind.mockResolvedValue([
      { amount: '1000.00', status: LevyTransferStatus.CONFIRMED },
    ]);
    snapshotCreate.mockImplementation((value: LevySurplusSnapshot) => value);
    snapshotSave.mockImplementation((value: LevySurplusSnapshot[]) =>
      Promise.resolve(value),
    );

    const result = await service.recompute('org-1');

    expect(forecastForOrganisation).toHaveBeenCalledWith('org-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      donorLinkId: 'link-1',
      donorLinkLabel: 'Group Ltd',
      totalBalance: '10000.00',
      committedToOwnApprenticeships: '1700.00',
      maxTransferable: '5000.00',
      alreadyTransferred: '1000.00',
      availableSurplus: '4000.00',
    });
  });

  it('treats already transferred as zero when no transfers exist', async () => {
    donorLinkFind.mockResolvedValue([
      {
        id: 'link-1',
        organisationId: 'org-1',
        label: null,
        status: DasDonorLinkStatus.LINKED,
        lastBalance: '4000.00',
      },
    ]);
    forecastForOrganisation.mockResolvedValue({
      organisationId: 'org-1',
      horizonMonths: 12,
      projectedMonthlySpend: 0,
      projectedCompletionLiability: 0,
    });
    transferFind.mockResolvedValue([]);
    snapshotCreate.mockImplementation((value: LevySurplusSnapshot) => value);
    snapshotSave.mockImplementation((value: LevySurplusSnapshot[]) =>
      Promise.resolve(value),
    );

    const result = await service.recompute('org-1');

    expect(result[0].alreadyTransferred).toBe('0.00');
    expect(result[0].maxTransferable).toBe('2000.00');
    expect(result[0].availableSurplus).toBe('2000.00');
  });

  it('groups expiry calendar tranches by month within 24 months', async () => {
    donorLinkFind.mockResolvedValue([
      {
        id: 'link-1',
        organisationId: 'org-1',
        label: 'Main account',
        status: DasDonorLinkStatus.LINKED,
      },
    ]);
    trancheFind.mockResolvedValue([
      {
        id: 'tranche-1',
        donorLinkId: 'link-1',
        amount: '1500.00',
        expiresOn: '2026-09-15',
      },
      {
        id: 'tranche-2',
        donorLinkId: 'link-1',
        amount: '500.00',
        expiresOn: '2026-09-30',
      },
    ]);

    const result = await service.getExpiryCalendar('org-1');

    expect(result).toHaveLength(1);
    expect(result[0].month).toBe('2026-09');
    expect(result[0].totalAmount).toBe('2000.00');
    expect(result[0].tranches).toHaveLength(2);
  });

  it('returns cached surplus snapshots via getSurplus', async () => {
    donorLinkFind.mockResolvedValue([
      {
        id: 'link-1',
        organisationId: 'org-1',
        label: 'Main',
        status: DasDonorLinkStatus.LINKED,
      },
    ]);
    snapshotFind.mockResolvedValue([
      {
        donorLinkId: 'link-1',
        totalBalance: '10000.00',
        committedToOwnApprenticeships: '2000.00',
        maxTransferable: '4000.00',
        alreadyTransferred: '1000.00',
        availableSurplus: '3000.00',
        computedAt: new Date('2026-01-01'),
      },
    ]);

    const result = await service.getSurplus('org-1');
    expect(result[0]).toMatchObject({
      donorLinkId: 'link-1',
      availableSurplus: '3000.00',
    });
  });

  it('returns latest surplus summary for organisation', async () => {
    snapshotFindOne.mockResolvedValue({
      organisationId: 'org-1',
      availableSurplus: '2500.00',
      computedAt: new Date('2026-01-01'),
    });

    const summary = await service.getLatestForOrganisation('org-1');
    expect(summary?.availableSurplus).toBe('2500.00');
  });

  it('returns null when no surplus snapshot exists', async () => {
    snapshotFindOne.mockResolvedValue(null);
    await expect(service.getLatestForOrganisation('org-1')).resolves.toBeNull();
  });

  it('loads latest snapshots for multiple organisations', async () => {
    snapshotGetMany.mockResolvedValue([
      {
        organisationId: 'donor-a',
        availableSurplus: '1000.00',
        computedAt: new Date('2026-01-01'),
      },
      {
        organisationId: 'donor-b',
        availableSurplus: '2000.00',
        computedAt: new Date('2026-01-02'),
      },
    ]);

    const map = await service.getLatestForOrganisations(['donor-a', 'donor-b']);
    expect(map.get('donor-a')?.availableSurplus).toBe('1000.00');
    expect(map.get('donor-b')?.availableSurplus).toBe('2000.00');
  });

  it('checks hasAvailableSurplus against minimum amount', async () => {
    snapshotFindOne.mockResolvedValue({
      organisationId: 'org-1',
      availableSurplus: '5000.00',
      computedAt: new Date('2026-01-01'),
    });

    await expect(service.hasAvailableSurplus('org-1', '4000.00')).resolves.toBe(
      true,
    );
    await expect(service.hasAvailableSurplus('org-1', '6000.00')).resolves.toBe(
      false,
    );
  });

  it('returns false for hasAvailableSurplus when no snapshot', async () => {
    snapshotFindOne.mockResolvedValue(null);
    await expect(service.hasAvailableSurplus('org-1', '100.00')).resolves.toBe(
      false,
    );
  });

  it('compares and picks minimum amounts', () => {
    expect(service.compareAmounts('10.00', '5.00')).toBeGreaterThan(0);
    expect(service.minAmount('10.00', '5.00')).toBe('5.00');
  });
});
