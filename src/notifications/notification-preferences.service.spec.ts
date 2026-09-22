import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { getRlsBootstrap } from '../common/context/correlation-id-context.js';

import { NotificationPreference } from './entities/notification-preference.entity.js';
import { DigestFrequency } from './enums/digest-frequency.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NOTIFICATION_TYPE_CATALOGUE } from './notification-type-catalogue.js';

describe('NotificationPreferencesService', () => {
  const findOne = jest.fn();
  const find = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const query = jest.fn();
  const preferenceRepo = { findOne, find, create, save, query };

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

    it("reads the recipient's cadence under the bootstrap window and writes nothing", async () => {
      // The digest worker runs with no user. The old path called
      // ensureDefaults, which inserted the recipient's rows as nobody — the
      // insert policy refused it and the job failed there.
      let bootstrapped: boolean | undefined;
      findOne.mockImplementation(() => {
        bootstrapped = getRlsBootstrap();
        return Promise.resolve(null);
      });

      // No row: the weekly default, and 2026-08-03 is a Monday.
      await expect(
        service.shouldSendDigestOn('user-1', NotificationType.OTJ, MONDAY),
      ).resolves.toBe(true);
      expect(bootstrapped).toBe(true);
      expect(findOne).toHaveBeenCalledTimes(1);
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ select: ['id', 'enabled', 'frequency'] }),
      );
      expect(create).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
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

  /** F3.4.3 AC3 — GET /notifications/preferences. */
  describe('listForUser', () => {
    const everyType = Object.keys(
      NOTIFICATION_TYPE_CATALOGUE,
    ) as NotificationType[];

    it('returns every (channel, type) pair, labelled, defaulting absent rows to enabled', async () => {
      find.mockResolvedValue([]);

      const matrix = await service.listForUser('user-1');

      expect(matrix.types.map((t) => t.type)).toEqual(everyType);
      for (const entry of matrix.types) {
        expect(entry.label).toBe(NOTIFICATION_TYPE_CATALOGUE[entry.type].label);
        expect(entry.channels.map((c) => c.channel)).toEqual([
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
          NotificationChannel.DIGEST,
          NotificationChannel.PUSH,
        ]);
        expect(entry.channels.every((c) => c.enabled)).toBe(true);
      }
      // A GET writes nothing: the default is a rule, not rows.
      expect(save).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it("reflects the user's stored choices, read per user", async () => {
      find.mockResolvedValue([
        {
          id: 'p-1',
          channel: NotificationChannel.EMAIL,
          type: NotificationType.REVIEW,
          enabled: false,
        },
      ]);

      const matrix = await service.listForUser('user-1');
      const review = matrix.types.find(
        (t) => t.type === NotificationType.REVIEW,
      );

      expect(
        review?.channels.find((c) => c.channel === NotificationChannel.EMAIL)
          ?.enabled,
      ).toBe(false);
      const [options] = find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(options.where).toMatchObject({ user: { id: 'user-1' } });
      expect(options.where.organisation).toBeDefined();
    });

    it('marks email on emailed types, and push on pushed types, as configurable', async () => {
      find.mockResolvedValue([]);

      const matrix = await service.listForUser('user-1');

      for (const entry of matrix.types) {
        const catalogue = NOTIFICATION_TYPE_CATALOGUE[entry.type];
        for (const pair of entry.channels) {
          const expected =
            (pair.channel === NotificationChannel.EMAIL && catalogue.emailed) ||
            (pair.channel === NotificationChannel.PUSH &&
              catalogue.pushed === true);
          expect(pair.configurable).toBe(expected);
        }
      }
      // F3.1.4 AC4 — the inactivity alert is pushed, so OTJ push is a switch.
      const otjPush = matrix.types
        .find((t) => t.type === NotificationType.OTJ)
        ?.channels.find((c) => c.channel === NotificationChannel.PUSH);
      expect(otjPush?.configurable).toBe(true);
      // The F3.4.3 AC2 types that are emailed today are switchable.
      const switchable = matrix.types
        .filter((t) => t.channels.some((c) => c.configurable))
        .map((t) => t.type);
      expect(switchable).toEqual(
        expect.arrayContaining([
          NotificationType.OTJ,
          NotificationType.REVIEW,
          NotificationType.MESSAGE,
          NotificationType.COMMITMENT,
          NotificationType.EPA_DATE_UPDATED,
          // F3.3.4 AC5 — the EPA pack download link is emailed.
          NotificationType.PORTFOLIO,
        ]),
      );
      // Declared, not emitted: nothing to switch off yet.
      expect(switchable).not.toContain(NotificationType.MILESTONE_COMPLETED);
    });
  });

  /** F3.4.3 AC3 — PATCH /notifications/preferences. */
  describe('setForUser', () => {
    it('upserts each pair on the per-user unique index, so concurrent saves converge on one row', async () => {
      query.mockResolvedValue(undefined);
      find.mockResolvedValue([]);

      await service.setForUser('user-1', [
        {
          channel: NotificationChannel.EMAIL,
          type: NotificationType.REVIEW,
          enabled: false,
        },
        {
          channel: NotificationChannel.EMAIL,
          type: NotificationType.MESSAGE,
          enabled: true,
        },
      ]);

      expect(query).toHaveBeenCalledTimes(2);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      // The conflict target is UQ_notification_preferences_user_default —
      // the partial index over the organisation-less rows. The older index
      // includes organisationId, and NULLs never conflict in it.
      expect(sql).toMatch(
        /ON CONFLICT \("userId", channel, type\)\s+WHERE "organisationId" IS NULL AND "isDeleted" = false/,
      );
      expect(sql).toMatch(/VALUES \(\$1, NULL,/);
      expect(params).toEqual([
        'user-1',
        NotificationChannel.EMAIL,
        NotificationType.REVIEW,
        false,
      ]);
    });
  });
});
