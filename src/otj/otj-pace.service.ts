import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';
import { OtjPaceAlertLevel } from './enums/otj-pace-alert-level.enum.js';
import {
  computeOtjPaceSnapshot,
  OTJ_AT_RISK_THRESHOLD_PERCENT,
  OTJ_OVERDUE_THRESHOLD_PERCENT,
} from './otj-pace-calculator.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OtjPaceService {
  private readonly logger = new Logger(OtjPaceService.name);

  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
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

    /**
     * The percentage is recorded on every evaluation, not only when the band
     * changes: an apprentice sliding from 16% to 45% behind stays `at_risk`
     * the whole way, and a stale number would understate a worsening case.
     *
     * The enrolment is otherwise only written when the band changes, so this
     * needs its own reason to save — tracked rather than saving
     * unconditionally, which would rewrite every active enrolment nightly for
     * no change.
     */
    const previousPercent =
      enrolment.otjBehindPercent === null ||
      enrolment.otjBehindPercent === undefined
        ? null
        : Number(enrolment.otjBehindPercent);
    const percentChanged = previousPercent !== snapshot.behindPercent;
    enrolment.otjBehindPercent = snapshot.behindPercent;

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
          snapshot.requiredWeeklyHours,
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
      await this.notifyPaceAlert(
        enrolment,
        nextLevel,
        snapshot.behindPercent,
        snapshot.requiredWeeklyHours,
      );
      notified = true;
    } else if (percentChanged) {
      // Band unchanged and no alert due, but the number moved — persist it so
      // the roster badge reflects how far behind they actually are today.
      await this.enrolmentRepo.save(enrolment);
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
    requiredWeeklyHours: number | null = null,
  ): Promise<void> {
    await this.notifyApprenticeOfPace(enrolment, level, behindPercent);
    await this.notifyLineManagerOfPace(
      enrolment,
      level,
      behindPercent,
      requiredWeeklyHours,
    );
  }

  private async notifyApprenticeOfPace(
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

  /**
   * F1.2.4 AC4 — "email notification sent to line manager within 24 hours of
   * flag being set".
   *
   * Previously nobody but the apprentice was told, and only in-app: an
   * employer whose apprentice drifted 40% behind their OTJ target received no
   * signal at all until somebody happened to open the roster. The 24-hour
   * window is met by the daily pace cron; this adds the recipient and the
   * channel the criterion actually asks for.
   *
   * Sent to the employer organisation rather than the enrolment's owning org,
   * because the line manager belongs to the employer — an enrolment owned by
   * the provider would otherwise file the notification under the wrong tenant.
   */
  private async notifyLineManagerOfPace(
    enrolment: Enrolment,
    level: OtjPaceAlertLevel,
    behindPercent: number | null,
    requiredWeeklyHours: number | null,
  ): Promise<void> {
    const managerUserId = enrolment.employerManagerUserId;
    if (!managerUserId) {
      this.logger.debug(
        `Skipping OTJ pace manager alert for enrolment ${enrolment.id}: no line manager linked`,
      );
      return;
    }

    const critical = level === OtjPaceAlertLevel.OFF_TRACK;
    const apprenticeName = await this.apprenticeNameFor(enrolment);
    const percentLabel =
      behindPercent !== null
        ? `${Math.round(behindPercent)}%`
        : 'significantly';

    try {
      await this.notificationsService.createForUser({
        userId: managerUserId,
        organisationId:
          enrolment.employerOrganisationId ?? enrolment.organisationId,
        type: NotificationType.OTJ,
        title: critical
          ? `${apprenticeName} is overdue on off-the-job hours`
          : `${apprenticeName} is at risk on off-the-job hours`,
        body: `${apprenticeName} is ${percentLabel} behind the off-the-job pace required for their EPA date.`,
        metadata: {
          enrolmentId: enrolment.id,
          apprenticeId: enrolment.apprenticeId,
          alertLevel: level,
          behindPercent,
          action: 'review_otj',
        },
      });

      const manager = await this.userRepo.findOne({
        where: { id: managerUserId, isDeleted: false },
      });

      if (manager?.email) {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(
            EmailTemplate.OTJ_PACE_ALERT,
            manager.email,
            {
              firstName: manager.firstName ?? 'there',
              apprenticeName,
              critical,
              behindPercent:
                behindPercent !== null ? Math.round(behindPercent) : null,
              requiredWeeklyHours,
              atRiskThreshold: OTJ_AT_RISK_THRESHOLD_PERCENT,
              overdueThreshold: OTJ_OVERDUE_THRESHOLD_PERCENT,
              appName: this.config.get<string>('app.email.appName', 'Graddly'),
            },
          ),
        );
      }
    } catch (error) {
      // The flag itself is already persisted. A failed alert must not roll
      // back the flagging, or a transient mail problem would leave the
      // apprentice unflagged as well as un-escalated.
      this.logger.warn(
        `OTJ pace manager alert failed for enrolment ${enrolment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async apprenticeNameFor(enrolment: Enrolment): Promise<string> {
    if (!enrolment.apprenticeId) return 'An apprentice';
    const apprentice = await this.apprenticeRepo.findOne({
      where: { id: enrolment.apprenticeId, isDeleted: false },
    });
    if (!apprentice) return 'An apprentice';
    const name =
      `${apprentice.firstName ?? ''} ${apprentice.lastName ?? ''}`.trim();
    return name || 'An apprentice';
  }
}
