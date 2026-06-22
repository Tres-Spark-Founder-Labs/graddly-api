import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';

export interface IOtjDigestRow {
  apprenticeName: string;
  loggedDate: string;
  minutes: number;
  category: string;
  activityName: string;
}

@Injectable()
export class OtjDigestService {
  private readonly logger = new Logger(OtjDigestService.name);

  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjLogRepo: Repository<OtjLogEntry>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly preferencesService: NotificationPreferencesService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
  ) {}

  async sendWeeklyDigestForOrganisation(
    organisationId: string,
  ): Promise<number> {
    const entries = await this.otjLogRepo.find({
      where: {
        organisationId,
        status: OtjLogStatus.SUBMITTED,
        isDeleted: false,
      },
      relations: ['enrolment', 'enrolment.apprentice'],
      order: { loggedDate: 'DESC' },
    });

    if (entries.length === 0) {
      return 0;
    }

    const byManager = new Map<string, IOtjDigestRow[]>();
    for (const entry of entries) {
      const managerId = entry.enrolment?.employerManagerUserId;
      if (!managerId) {
        continue;
      }

      const apprentice = entry.enrolment.apprentice;
      const row: IOtjDigestRow = {
        apprenticeName: `${apprentice.firstName} ${apprentice.lastName}`,
        loggedDate:
          typeof entry.loggedDate === 'string'
            ? entry.loggedDate.slice(0, 10)
            : String(entry.loggedDate),
        minutes: entry.minutes,
        category: entry.category,
        activityName: entry.activityName,
      };

      const bucket = byManager.get(managerId) ?? [];
      bucket.push(row);
      byManager.set(managerId, bucket);
    }

    if (byManager.size === 0) {
      return 0;
    }

    const managers = await this.userRepo.find({
      where: { id: In([...byManager.keys()]), isDeleted: false },
    });

    let sent = 0;
    for (const manager of managers) {
      const rows = byManager.get(manager.id) ?? [];
      if (rows.length === 0) {
        continue;
      }

      const digestEnabled = await this.preferencesService.isChannelEnabled(
        manager.id,
        NotificationType.OTJ,
        NotificationChannel.DIGEST,
      );
      if (!digestEnabled) {
        continue;
      }

      if (!manager.email) {
        continue;
      }

      try {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(
            EmailTemplate.OTJ_WEEKLY_DIGEST,
            manager.email,
            {
              firstName: manager.firstName,
              pendingCount: rows.length,
              entries: rows,
              appName: this.config.get<string>('app.email.appName', 'Graddly'),
            },
          ),
        );
        sent++;
      } catch (error) {
        this.logger.warn(
          `OTJ digest failed for manager ${manager.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return sent;
  }
}
