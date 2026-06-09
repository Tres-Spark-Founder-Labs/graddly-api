import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasLevyTranche } from './entities/das-levy-tranche.entity.js';
import { DasDonorSyncService } from './services/das-donor-sync.service.js';

describe('DasDonorSyncService', () => {
  let service: DasDonorSyncService;

  const trancheDelete = jest.fn();
  const trancheCreate = jest.fn();
  const trancheSave = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasDonorSyncService,
        {
          provide: getRepositoryToken(DasLevyTranche),
          useValue: {
            delete: trancheDelete,
            create: trancheCreate,
            save: trancheSave,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DasDonorSyncService);
    jest.clearAllMocks();
  });

  it('parses tranches from raw payload', () => {
    const parsed = service.parseTranches({
      tranches: [
        { amount: 1500, expiresOn: '2027-06-01' },
        { balance: '500.00', expiryDate: '2027-12-31' },
      ],
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      amount: '1500.00',
      expiresOn: '2027-06-01',
    });
    expect(parsed[1]).toMatchObject({
      amount: '500.00',
      expiresOn: '2027-12-31',
    });
  });

  it('returns empty array when no tranches in payload', () => {
    expect(service.parseTranches({})).toEqual([]);
  });

  it('replaces tranches for donor link', async () => {
    trancheDelete.mockResolvedValue(undefined);
    trancheCreate.mockImplementation((value: DasLevyTranche) => value);
    trancheSave.mockImplementation((rows: DasLevyTranche[]) =>
      Promise.resolve(rows),
    );

    const result = await service.replaceTranches('link-1', 'org-1', {
      tranches: [{ amount: 1000, expiresOn: '2027-01-01' }],
    });

    expect(trancheDelete).toHaveBeenCalledWith({
      donorLinkId: 'link-1',
      organisationId: 'org-1',
    });
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe('1000.00');
  });
});
