import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { NotificationPreference } from './entities/notification-preference.entity.js';
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
  ) {}

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
}
