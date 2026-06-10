import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';
import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import { computeOtjPaceSnapshot } from './otj-pace-calculator.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OtjPaceService {
  private readonly logger = new Logger(OtjPaceService.name);

  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async flagPaceForAllActiveEnrolments(): Promise<number> {
    const activeEnrolments = await this.enrolmentRepo.find({
      where: { status: EnrolmentStatus.ACTIVE, isDeleted: false },
    });
    let updated = 0;
    for (const enrolment of activeEnrolments) {
      const changed = await this.evaluateEnrolmentPace(enrolment);
      if (changed) {
        updated += 1;
      }
    }
    return updated;
  }

  async evaluateEnrolmentPace(
    enrolment: Enrolment,
    options: { asOf?: Date } = {},
  ): Promise<boolean> {
    const actorUserId = enrolment.apprenticeUserId ?? 'system-otj-pace';
    setCurrentOrganisationId(enrolment.organisationId);
    setCurrentUserId(actorUserId);
    setLastKnownUserIdForGuc(actorUserId);

    const approvedMinutes = await this.sumApprovedMinutes(
      enrolment.id,
      enrolment.organisationId,
    );
    const snapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: enrolment.plannedDurationMonths,
      plannedStartDate: enrolment.plannedStartDate,
      plannedEndDate: enrolment.plannedEndDate,
      activatedAt: enrolment.activatedAt,
      epaDate: enrolment.epaDate,
      approvedMinutes,
      asOf: options.asOf,
    });

    const nextLevel = snapshot.alertLevel;
    const previousLevel = enrolment.otjPaceAlertLevel;
    let notified = false;

    if (nextLevel !== previousLevel) {
      enrolment.otjPaceAlertLevel = nextLevel;
      enrolment.otjPaceAlertedAt = new Date();
      if (
        nextLevel === OtjPaceAlertLevel.AT_RISK ||
        nextLevel === OtjPaceAlertLevel.OFF_TRACK
      ) {
        await this.notifyPaceAlert(
          enrolment,
          nextLevel,
          snapshot.behindPercent,
        );
        notified = true;
      }
      await this.enrolmentRepo.save(enrolment);
    } else if (
      nextLevel &&
      (nextLevel === OtjPaceAlertLevel.AT_RISK ||
        nextLevel === OtjPaceAlertLevel.OFF_TRACK) &&
      this.shouldRecurWeekly(enrolment.otjPaceAlertedAt)
    ) {
      enrolment.otjPaceAlertedAt = new Date();
      await this.enrolmentRepo.save(enrolment);
      await this.notifyPaceAlert(enrolment, nextLevel, snapshot.behindPercent);
      notified = true;
    }

    await this.syncLogEntryFlags(
      enrolment.id,
      enrolment.organisationId,
      nextLevel,
    );
    return notified;
  }

  private shouldRecurWeekly(lastAlertedAt: Date | null): boolean {
    if (!lastAlertedAt) {
      return true;
    }
    return Date.now() - lastAlertedAt.getTime() >= WEEK_MS;
  }

  private async syncLogEntryFlags(
    enrolmentId: string,
    organisationId: string,
    alertLevel: OtjPaceAlertLevel | null,
  ): Promise<void> {
    if (!alertLevel) {
      return;
    }
    const paceFlag = alertLevel;
    const entries = await this.otjRepo.find({
      where: {
        enrolmentId,
        organisationId,
        isDeleted: false,
        status: OtjLogStatus.APPROVED,
      },
    });
    for (const entry of entries) {
      if (entry.paceFlag !== paceFlag) {
        entry.paceFlag = paceFlag;
        await this.otjRepo.save(entry);
      }
    }
  }

  private async sumApprovedMinutes(
    enrolmentId: string,
    organisationId: string,
  ): Promise<number> {
    const row = await this.otjRepo
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.minutes), 0)', 'total')
      .where('entry.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('entry.organisationId = :organisationId', { organisationId })
      .andWhere('entry.status = :status', { status: OtjLogStatus.APPROVED })
      .andWhere('entry.isDeleted = false')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  private async notifyPaceAlert(
    enrolment: Enrolment,
    level: OtjPaceAlertLevel,
    behindPercent: number | null,
  ): Promise<void> {
    if (!enrolment.apprenticeUserId) {
      this.logger.debug(
        `Skipping OTJ pace notification for enrolment ${enrolment.id}: no apprentice user linked`,
      );
      return;
    }

    const title =
      level === OtjPaceAlertLevel.OFF_TRACK
        ? 'OTJ pace critically behind'
        : 'OTJ pace behind target';
    const body =
      behindPercent !== null
        ? `You are ${Math.round(behindPercent)}% behind the OTJ pace required for your EPA date. Log hours now to get back on track.`
        : 'Your OTJ pace is behind the target required for your EPA date. Log hours now to get back on track.';

    await this.notificationsService.createForUser({
      userId: enrolment.apprenticeUserId,
      organisationId: enrolment.organisationId,
      type: NotificationType.OTJ,
      title,
      body,
      metadata: {
        enrolmentId: enrolment.id,
        alertLevel: level,
        behindPercent,
        action: 'log_otj',
      },
    });
  }
}
