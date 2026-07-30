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

  /**
   * F1.2.3 AC6/AC7 — sends the pending-approvals digest to each line manager
   * who is due one today.
   *
   * "Due today" is per manager, not per run: the cron fires daily and each
   * manager's daily/weekly/off preference decides whether they receive this
   * one. Weekly subscribers get theirs on Monday, which is what AC6 asks for,
   * without a second cron.
   *
   * `now` is injectable so the Monday boundary can be tested without moving
   * the system clock.
   */
  async sendDigestForOrganisation(
    organisationId: string,
    now: Date = new Date(),
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

      // AC7 — daily/weekly/off. Replaces a plain on/off channel check, which
      // could not express "daily" and so sent to everyone on the weekly run.
      const due = await this.preferencesService.shouldSendDigestOn(
        manager.id,
        NotificationType.OTJ,
        now,
      );
      if (!due) {
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
