import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  runWithCorrelationId,
} from '../common/context/correlation-id-context.js';

import { LevyTransferPreference } from './entities/levy-transfer-preference.entity.js';
import { LevyTransferPreferenceService } from './services/levy-transfer-preference.service.js';

describe('LevyTransferPreferenceService', () => {
  let service: LevyTransferPreferenceService;

  const preferenceFindOne = jest.fn();
  const preferenceFind = jest.fn();
  const preferenceCreate = jest.fn();
  const preferenceSave = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyTransferPreferenceService,
        {
          provide: getRepositoryToken(LevyTransferPreference),
          useValue: {
            findOne: preferenceFindOne,
            find: preferenceFind,
            create: preferenceCreate,
            save: preferenceSave,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyTransferPreferenceService);
    jest.clearAllMocks();
  });

  it('creates transfer preferences', async () => {
    preferenceFindOne.mockResolvedValue(null);
    preferenceCreate.mockImplementation(
      (value: LevyTransferPreference) => value,
    );
    preferenceSave.mockImplementation((value: LevyTransferPreference) =>
      Promise.resolve({
        ...value,
        id: 'pref-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.upsert('org-1', {
      sectors: ['Digital & Technology'],
      regions: ['North West'],
      sizeBands: ['10-49'],
      programmeTypes: ['software_developer'],
      maxPerRecipient: '20000.00',
      openMatching: false,
      anonymousMatching: true,
    });

    expect(result.sectors).toEqual(['Digital & Technology']);
    expect(result.anonymousMatching).toBe(true);
  });

  it('gets transfer preferences', async () => {
    preferenceFindOne.mockResolvedValue({
      id: 'pref-1',
      organisationId: 'org-1',
      sectors: ['Digital & Technology'],
      regions: ['North West'],
      sizeBands: ['10-49'],
      programmeTypes: ['software_developer'],
      maxPerRecipient: '20000.00',
      openMatching: false,
      anonymousMatching: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    const result = await service.get('org-1');
    expect(result.id).toBe('pref-1');
  });

  it('finds all active preferences', async () => {
    preferenceFind.mockResolvedValue([{ id: 'pref-1' }, { id: 'pref-2' }]);
    await expect(service.findAllActive()).resolves.toHaveLength(2);
  });

  it('throws when preferences missing on get', async () => {
    preferenceFindOne.mockResolvedValue(null);
    await expect(service.get('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when preferences missing on getEntityOrThrow', async () => {
    preferenceFindOne.mockResolvedValue(null);
    await expect(service.getEntityOrThrow('org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * The anonymity flag for an SME's applications: a counterparty read past an
   * owner-only policy. Pinned here — the one column and the key, the flag on
   * for that read alone, no read when there are no donors.
   */
  describe('anonymousMatchingByOrganisation', () => {
    it('reads the flag and the key only, in a window it closes', async () => {
      const flagDuringRead: boolean[] = [];
      preferenceFind.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve([
          { organisationId: 'donor-a', anonymousMatching: true },
          { organisationId: 'donor-b', anonymousMatching: false },
        ]);
      });

      await runWithCorrelationId('preference-spec', async () => {
        const result = await service.anonymousMatchingByOrganisation([
          'donor-a',
          'donor-b',
        ]);
        expect([...result]).toEqual([
          ['donor-a', true],
          ['donor-b', false],
        ]);
        expect(flagDuringRead).toEqual([true]);
        expect(getRlsBootstrap()).toBe(false);
      });

      const [options] = preferenceFind.mock.calls[0] as [{ select: string[] }];
      expect(options.select).toEqual(['organisationId', 'anonymousMatching']);
    });

    it('reads nothing for no donors', async () => {
      await expect(
        service.anonymousMatchingByOrganisation([]),
      ).resolves.toEqual(new Map());
      expect(preferenceFind).not.toHaveBeenCalled();
    });
  });

  it('normalises the open lists as the recipient side does, and stores closed ones as sent', async () => {
    preferenceFindOne.mockResolvedValue(null);
    preferenceCreate.mockImplementation(
      (value: LevyTransferPreference) => value,
    );
    preferenceSave.mockImplementation((value: LevyTransferPreference) =>
      Promise.resolve({
        ...value,
        id: 'pref-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.upsert('org-1', {
      sectors: ['  Digital   &  Technology ', '   '],
      regions: ['North West'],
      sizeBands: ['10-49'],
      programmeTypes: [' ST0116	Software   developer'],
      maxPerRecipient: null,
      openMatching: false,
      anonymousMatching: false,
    });

    expect(result).toMatchObject({
      sectors: ['Digital & Technology'],
      regions: ['North West'],
      sizeBands: ['10-49'],
      programmeTypes: ['ST0116 Software developer'],
    });
  });
});
