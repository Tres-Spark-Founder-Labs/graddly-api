import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { isMondayIn } from '../common/time/timezone.util.js';

import { NotificationPreference } from './entities/notification-preference.entity.js';
import {
  DEFAULT_DIGEST_FREQUENCY,
  DigestFrequency,
} from './enums/digest-frequency.enum.js';
import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';

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

  async isChannelEnabled(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    await this.ensureDefaults(userId);

    const preference = await this.preferenceRepo.findOne({
      where: {
        user: { id: userId },
        organisation: IsNull(),
        channel,
        type,
        isDeleted: false,
      },
    });

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
    const frequency = await this.getDigestFrequency(userId, type);

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
