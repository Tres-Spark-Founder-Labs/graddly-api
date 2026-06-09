import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationPreference } from './entities/notification-preference.entity.js';
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
});
