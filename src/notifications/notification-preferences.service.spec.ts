import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationPreference } from './entities/notification-preference.entity.js';
import { DigestFrequency } from './enums/digest-frequency.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';

describe('NotificationPreferencesService', () => {
  const findOne = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const preferenceRepo = { findOne, create, save };

  let service: NotificationPreferencesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferenceRepo,
        },
        {
          provide: ConfigService,
          // Fixed zone so the Monday assertions below are deterministic
          // regardless of where the suite runs.
          useValue: { get: jest.fn(() => 'Europe/London') },
        },
      ],
    }).compile();
    service = moduleRef.get(NotificationPreferencesService);
  });

  describe('ensureDefaults', () => {
    it('creates missing global default preferences', async () => {
      findOne.mockResolvedValue(null);
      create.mockImplementation(
        (value: Partial<NotificationPreference>) => value,
      );
      save.mockResolvedValue(undefined);

      await service.ensureDefaults('user-1');

      expect(create).toHaveBeenCalled();
      expect(save).toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { id: 'user-1' },
          organisation: null,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.SYSTEM,
          enabled: true,
        }),
      );
    });

    it('skips preferences that already exist', async () => {
      findOne.mockResolvedValue({ id: 'pref-1' });

      await service.ensureDefaults('user-1');

      expect(create).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });
  });

  // F1.2.3 AC7 — daily / weekly / off.
  describe('digest frequency', () => {
    /** 2026-08-03 is a Monday; 2026-08-04 a Tuesday. */
    const MONDAY = new Date('2026-08-03T08:00:00Z');
    const TUESDAY = new Date('2026-08-04T08:00:00Z');

    const givenPreference = (
      preference: Partial<NotificationPreference> | null,
    ) => {
      findOne.mockResolvedValue(preference ? { ...preference } : null);
    };

    it('returns the stored frequency', async () => {
      givenPreference({ enabled: true, frequency: DigestFrequency.DAILY });

      await expect(
        service.getDigestFrequency('user-1', NotificationType.OTJ),
      ).resolves.toBe(DigestFrequency.DAILY);
    });

    it('reports OFF when the channel is disabled, whatever frequency is stored', async () => {
      // Guards the case where a manager switches the digest channel off but a
      // frequency set earlier is still on the row.
      givenPreference({ enabled: false, frequency: DigestFrequency.DAILY });

      await expect(
        service.getDigestFrequency('user-1', NotificationType.OTJ),
      ).resolves.toBe(DigestFrequency.OFF);
    });

    it('sends daily subscribers on a Tuesday', async () => {
      givenPreference({ enabled: true, frequency: DigestFrequency.DAILY });

      await expect(
        service.shouldSendDigestOn('user-1', NotificationType.OTJ, TUESDAY),
      ).resolves.toBe(true);
    });

    it('sends weekly subscribers on Monday only', async () => {
      givenPreference({ enabled: true, frequency: DigestFrequency.WEEKLY });
      await expect(
        service.shouldSendDigestOn('user-1', NotificationType.OTJ, MONDAY),
      ).resolves.toBe(true);

      givenPreference({ enabled: true, frequency: DigestFrequency.WEEKLY });
      await expect(
        service.shouldSendDigestOn('user-1', NotificationType.OTJ, TUESDAY),
      ).resolves.toBe(false);
    });

    it('never sends when off', async () => {
      givenPreference({ enabled: false, frequency: DigestFrequency.OFF });

      await expect(
        service.shouldSendDigestOn('user-1', NotificationType.OTJ, MONDAY),
      ).resolves.toBe(false);
    });

    it('turning the digest off also disables the channel', async () => {
      // Otherwise `enabled` and `frequency` can disagree about whether to
      // deliver, and the two read paths give different answers.
      const existing = {
        id: 'pref-1',
        enabled: true,
        frequency: DigestFrequency.WEEKLY,
      };
      findOne.mockResolvedValue(existing);
      save.mockImplementation((row: NotificationPreference) => row);

      await service.setDigestFrequency(
        'user-1',
        NotificationType.OTJ,
        DigestFrequency.OFF,
      );

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency: DigestFrequency.OFF,
          enabled: false,
        }),
      );
    });

    it('re-enables the channel when a cadence is chosen again', async () => {
      const existing = {
        id: 'pref-1',
        enabled: false,
        frequency: DigestFrequency.OFF,
      };
      findOne.mockResolvedValue(existing);
      save.mockImplementation((row: NotificationPreference) => row);

      await service.setDigestFrequency(
        'user-1',
        NotificationType.OTJ,
        DigestFrequency.DAILY,
      );

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency: DigestFrequency.DAILY,
          enabled: true,
        }),
      );
    });
  });
});
