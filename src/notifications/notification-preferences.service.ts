import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { withRlsBootstrap } from '../common/context/correlation-id-context.js';
import { isMondayIn } from '../common/time/timezone.util.js';

import { NotificationPreference } from './entities/notification-preference.entity.js';
import {
  DEFAULT_DIGEST_FREQUENCY,
  DigestFrequency,
} from './enums/digest-frequency.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';
import {
  isConfigurablePreference,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPE_CATALOGUE,
} from './notification-type-catalogue.js';

/** Every (channel, type) pair for one user — GET /notifications/preferences. */
export interface INotificationPreferenceMatrix {
  types: {
    type: NotificationType;
    label: string;
    channels: {
      channel: NotificationChannel;
      enabled: boolean;
      configurable: boolean;
    }[];
  }[];
}

const DEFAULT_TYPES = [
  NotificationType.SYSTEM,
  NotificationType.GENERIC,
  NotificationType.INVITATION,
  NotificationType.OTJ,
  NotificationType.REVIEW,
  NotificationType.COMMITMENT,
  NotificationType.PORTFOLIO,
  NotificationType.MESSAGE,
] as const;

const DEFAULT_CHANNELS = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.DIGEST,
] as const;

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    private readonly config: ConfigService,
  ) {}

  private get digestTimeZone(): string {
    return this.config.get<string>('app.cron.digestTimeZone', 'Europe/London');
  }

  async ensureDefaults(userId: string): Promise<void> {
    for (const type of DEFAULT_TYPES) {
      for (const channel of DEFAULT_CHANNELS) {
        const existing = await this.preferenceRepo.findOne({
          where: {
            user: { id: userId },
            organisation: IsNull(),
            channel,
            type,
            isDeleted: false,
          },
        });
        if (existing) {
          continue;
        }

        const preference = this.preferenceRepo.create({
          user: { id: userId },
          organisation: null,
          channel,
          type,
          enabled: true,
        });
        await this.preferenceRepo.save(preference);
      }
    }
  }

  /**
   * F3.4.3 AC3 — every (channel, type) pair for this user, with its state.
   *
   * Read as the user themself, under their own `notification_preferences`
   * policy. An absent row is `enabled: true`, the same default the send path
   * applies — and nothing is written: this is a GET, and the defaults are a
   * rule, not rows.
   */
  async listForUser(userId: string): Promise<INotificationPreferenceMatrix> {
    const rows = await this.preferenceRepo.find({
      where: { user: { id: userId }, organisation: IsNull(), isDeleted: false },
      select: ['id', 'channel', 'type', 'enabled'],
    });
    const stored = new Map(
      rows.map((row) => [`${row.channel}:${row.type}`, row.enabled]),
    );

    return {
      types: (
        Object.keys(NOTIFICATION_TYPE_CATALOGUE) as NotificationType[]
      ).map((type) => ({
        type,
        label: NOTIFICATION_TYPE_CATALOGUE[type].label,
        channels: NOTIFICATION_CHANNELS.map((channel) => ({
          channel,
          enabled: stored.get(`${channel}:${type}`) ?? true,
          configurable: isConfigurablePreference(channel, type),
        })),
      })),
    };
  }

  /**
   * F3.4.3 AC3 — set the user's own preferences, one row per (channel, type).
   *
   * Per user, not per organisation — the reasoning is on migration
   * 1781100000057. Each pair is written with `INSERT … ON CONFLICT` against
   * `UQ_notification_preferences_user_default`, the partial unique index over
   * exactly the per-user rows, so two concurrent saves converge on one row
   * instead of creating a second. Written as the user, so the
   * `notification_preferences` policies apply unchanged.
   *
   * The caller has already refused any pair that is not configurable.
   */
  async setForUser(
    userId: string,
    preferences: readonly {
      channel: NotificationChannel;
      type: NotificationType;
      enabled: boolean;
    }[],
  ): Promise<INotificationPreferenceMatrix> {
    for (const preference of preferences) {
      await this.preferenceRepo.query(
        `INSERT INTO notification_preferences ("userId", "organisationId", channel, type, enabled)
         VALUES ($1, NULL, $2, $3, $4)
         ON CONFLICT ("userId", channel, type)
           WHERE "organisationId" IS NULL AND "isDeleted" = false
         DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`,
        [userId, preference.channel, preference.type, preference.enabled],
      );
    }
    return this.listForUser(userId);
  }

  /**
   * THE SEND-TIME READ: is this channel on for this recipient and type?
   *
   * `NotificationsService.isEmailEnabled` is the only caller, and everything
   * that emails a person about a notification type goes through it.
   *
   * ── WHY IT READS UNDER THE BOOTSTRAP FLAG ───────────────────────────────
   *
   * The recipient is almost never the actor: a tutor's approval emails an
   * apprentice, a sender's message emails the other party, a cron emails
   * everyone. `notification_preferences_select` admits only
   * `"userId" = app_current_user()`, so read as the actor the recipient's row
   * is invisible, `?? true` answers "enabled", and the preference is ignored.
   * That is not hypothetical: `MessageNotificationDispatchService` read it
   * this way, and a rolled-back probe as `graddly_app` showed a recipient who
   * had switched message emails off reading as on to the sender.
   *
   * So this is a read under the rule on `withRlsBootstrap`: one named column
   * (`enabled`) of at most one row, the user id supplied by a caller that
   * took it from a record it had already read (the enrolment, the review, the
   * thread), and a window holding this read and nothing else. The value never
   * leaves the service — it decides only whether the recipient's own wish is
   * honoured.
   *
   * Nothing is written. The old `isChannelEnabled` called `ensureDefaults`
   * first, which inserts rows for the *recipient* as the actor — refused by
   * the insert policy — and ran two dozen queries per check. An absent row
   * is simply `true`.
   */
  async isEnabledForRecipient(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const preference = await withRlsBootstrap(() =>
      this.preferenceRepo.findOne({
        where: {
          user: { id: userId },
          organisation: IsNull(),
          channel,
          type,
          isDeleted: false,
        },
        select: ['id', 'enabled'],
      }),
    );
    return preference?.enabled ?? true;
  }

  /**
   * F1.2.3 AC7 — the manager's configured digest cadence for a notification
   * type.
   *
   * `enabled = false` is treated as OFF regardless of the stored frequency, so
   * a manager who switches the digest channel off does not keep receiving mail
   * because a frequency was set earlier.
   */
  async getDigestFrequency(
    userId: string,
    type: NotificationType,
  ): Promise<DigestFrequency> {
    await this.ensureDefaults(userId);

    const preference = await this.preferenceRepo.findOne({
      where: {
        user: { id: userId },
        organisation: IsNull(),
        channel: NotificationChannel.DIGEST,
        type,
        isDeleted: false,
      },
    });

    if (!preference || !preference.enabled) {
      return preference ? DigestFrequency.OFF : DEFAULT_DIGEST_FREQUENCY;
    }

    return preference.frequency ?? DEFAULT_DIGEST_FREQUENCY;
  }

  /**
   * The digest cadence of someone who is not the actor — the send path.
   *
   * Read-only, as `isEnabledForRecipient` is for email and for the same
   * reason: the digest worker runs with no user, so `getDigestFrequency`'s
   * `ensureDefaults` inserted rows for the *recipient* as nobody, which the
   * insert policy refuses — the job failed there (proved as graddly_app in a
   * rolled-back probe). So: one row, three named columns, under the rule on
   * `withRlsBootstrap`, the user id from a record the caller already read.
   * An absent row is the default cadence, exactly as `getDigestFrequency`
   * would have written it; nothing is written.
   */
  async getDigestFrequencyForRecipient(
    userId: string,
    type: NotificationType,
  ): Promise<DigestFrequency> {
    const preference = await withRlsBootstrap(() =>
      this.preferenceRepo.findOne({
        where: {
          user: { id: userId },
          organisation: IsNull(),
          channel: NotificationChannel.DIGEST,
          type,
          isDeleted: false,
        },
        select: ['id', 'enabled', 'frequency'],
      }),
    );

    if (!preference) {
      return DEFAULT_DIGEST_FREQUENCY;
    }
    if (!preference.enabled) {
      return DigestFrequency.OFF;
    }
    return preference.frequency ?? DEFAULT_DIGEST_FREQUENCY;
  }

  /**
   * Sets the digest cadence. OFF also clears `enabled` so the two
   * representations of "do not send" cannot disagree with each other.
   */
  async setDigestFrequency(
    userId: string,
    type: NotificationType,
    frequency: DigestFrequency,
  ): Promise<NotificationPreference> {
    await this.ensureDefaults(userId);

    const preference = await this.preferenceRepo.findOne({
      where: {
        user: { id: userId },
        organisation: IsNull(),
        channel: NotificationChannel.DIGEST,
        type,
        isDeleted: false,
      },
    });

    const target =
      preference ??
      this.preferenceRepo.create({
        user: { id: userId },
        organisation: null,
        channel: NotificationChannel.DIGEST,
        type,
      });

    target.frequency = frequency;
    target.enabled = frequency !== DigestFrequency.OFF;

    return this.preferenceRepo.save(target);
  }

  /**
   * Whether a digest should go out to this user on the given day.
   *
   * The decision lives here, not in the cron, because frequency is per-user
   * while the cron is per-organisation — one weekly job could never honour a
   * manager who asked for daily. The cron now runs daily and each user's
   * cadence is applied at send time.
   */
  async shouldSendDigestOn(
    userId: string,
    type: NotificationType,
    when: Date,
  ): Promise<boolean> {
    const frequency = await this.getDigestFrequencyForRecipient(userId, type);

    if (frequency === DigestFrequency.OFF) {
      return false;
    }
    if (frequency === DigestFrequency.DAILY) {
      return true;
    }

    // WEEKLY — Monday only, per AC6. Read in the digest timezone rather than
    // the server's, so a server in a non-UK region does not shift which day
    // counts as Monday.
    return isMondayIn(when, this.digestTimeZone);
  }
}
