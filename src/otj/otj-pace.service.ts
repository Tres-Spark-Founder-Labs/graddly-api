import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import {
  getRlsBootstrap,
  setCurrentOrganisationId,
  setCurrentUserId,
  setRlsBootstrap,
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
  OTJ_AT_RISK_THRESHOLD_PERCENT,
  OTJ_OVERDUE_THRESHOLD_PERCENT,
} from './otj-pace-calculator.js';
import { OtjSummaryService } from './otj-summary.service.js';

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
    private readonly otjSummary: OtjSummaryService,
  ) {}

  async flagPaceForAllActiveEnrolments(): Promise<number> {
    /**
     * Security hardening pass, item 7 — the sweep read needs bootstrap.
     *
     * This is a nightly cron. There is no request, so no signed-in user and no
     * active organisation, and `enrolments_select` resolves to nothing: the
     * find returned **zero rows for every organisation on the platform** and
     * the job logged a healthy "flagged 0". Proven by seeding a row and
     * counting with and without `app.rls_bootstrap` — see
     * `test/cron-tenant-context.e2e-spec.ts`.
     *
     * SCOPED TO THIS READ ONLY, deliberately. `evaluateEnrolmentPace` sets
     * `app.current_org` per enrolment on the next line down, and every read it
     * makes is correctly scoped to that one organisation. Wrapping the whole
     * loop in bootstrap would keep the flag set underneath that per-tenant
     * context and quietly weaken it — the fix would then be hiding a wider
     * problem than the one it solves.
     */
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let activeEnrolments: Enrolment[];
    try {
      activeEnrolments = await this.enrolmentRepo.find({
        where: { status: EnrolmentStatus.ACTIVE, isDeleted: false },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

    let updated = 0;
    for (const enrolment of activeEnrolments) {
      /**
       * One enrolment failing must not cost every other learner their nightly
       * pace evaluation — the same guard `EifScoreSnapshotService.captureAll`
       * already uses. This sweep had none, so a single malformed record would
       * have aborted the whole run once it started seeing rows at all.
       */
      try {
        const changed = await this.evaluateEnrolmentPace(enrolment);
        if (changed) {
          updated += 1;
        }
      } catch (error) {
        this.logger.warn(
          `OTJ pace evaluation failed for enrolment ${enrolment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return updated;
  }

  async evaluateEnrolmentPace(
    enrolment: Enrolment,
    options: { asOf?: Date } = {},
  ): Promise<boolean> {
    /**
     * Security hardening pass, item 7 — a latent crash the RLS no-op was
     * hiding.
     *
     * This used to read `enrolment.apprenticeUserId ?? 'system-otj-pace'`.
     * The GUC is a uuid column, so that sentinel threw
     * `invalid input syntax for type uuid` for every enrolment with no linked
     * apprentice account.
     *
     * Nobody ever saw it, because the sweep above returned zero enrolments and
     * this line was unreachable in production. Fixing the tenant-context bug
     * is what surfaced it — the silence was hiding a crash, not just work not
     * being done.
     *
     * An empty user id is the honest value: the pace evaluation genuinely has
     * no acting user when the learner has not registered yet. The organisation
     * context is what the RLS policies need, and that is always present.
     */
    const actorUserId = enrolment.apprenticeUserId ?? '';
    setCurrentOrganisationId(enrolment.organisationId);
    setCurrentUserId(actorUserId || undefined);
    setLastKnownUserIdForGuc(actorUserId);

    /**
     * P0-A — the approved-minutes sum used to live here as a private
     * `sumApprovedMinutes`, alongside a second copy in
     * `OtjProgressMetricsService`. Both are gone; `OtjSummaryService` owns it.
     *
     * The organisation filter went with it, deliberately. It was redundant
     * (an enrolment belongs to one organisation, so filtering the entries by
     * organisation as well narrows nothing) and actively wrong for any caller
     * whose active organisation is not the one that stamped the rows — the
     * exact defect that produced 0% averages on the employer's provider
     * comparison.
     */
    const snapshot = await this.otjSummary.paceForEnrolment(enrolment, {
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
      /**
       * Security hardening pass, item 7 — notify FIRST, stamp only on success.
       *
       * This block used to write `otjPaceAlertedAt` and save it *before*
       * attempting the alert. `notifyPaceAlert` can legitimately reach nobody
       * — an enrolment with no apprentice user linked returns early — so a
       * failed alert still recorded that one had been sent.
       *
       * That is worse than a plain no-op, and it is the exact shape of the
       * commitment-chase bug: `shouldRecurWeekly` reads this same timestamp,
       * so the false stamp pushed the next attempt out by a full week. The
       * bug erased the evidence of itself and closed the door behind it.
       *
       * The learner keeps their old `otjPaceAlertedAt` when delivery fails,
       * which leaves them eligible for tomorrow's run.
       */
      const delivered = await this.notifyPaceAlert(
        enrolment,
        nextLevel,
        snapshot.behindPercent,
        snapshot.requiredWeeklyHours,
      );

      if (delivered) {
        enrolment.otjPaceAlertedAt = new Date();
        await this.enrolmentRepo.save(enrolment);
        notified = true;
      } else {
        this.logger.warn(
          `OTJ pace alert reached nobody for enrolment ${enrolment.id}; leaving it eligible for the next run`,
        );
        // The percentage still moved and is worth persisting.
        if (percentChanged) {
          await this.enrolmentRepo.save(enrolment);
        }
      }
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

  /**
   * Security hardening pass, item 7 — returns whether the alert reached a
   * real recipient.
   *
   * It used to return void, so a caller could not tell delivery from a silent
   * skip: `notifyApprenticeOfPace` returns early when the enrolment has no
   * apprentice user linked, which is common on a draft-ish record. The caller
   * then stamped `otjPaceAlertedAt` anyway.
   */
  private async notifyPaceAlert(
    enrolment: Enrolment,
    level: OtjPaceAlertLevel,
    behindPercent: number | null,
    requiredWeeklyHours: number | null = null,
  ): Promise<boolean> {
    const apprenticeNotified = await this.notifyApprenticeOfPace(
      enrolment,
      level,
      behindPercent,
    );
    const managerNotified = await this.notifyLineManagerOfPace(
      enrolment,
      level,
      behindPercent,
      requiredWeeklyHours,
    );
    // Either party counts. Reaching the line manager is still a delivered
    // alert even when the apprentice has no account yet.
    return apprenticeNotified || managerNotified;
  }

  private async notifyApprenticeOfPace(
    enrolment: Enrolment,
    level: OtjPaceAlertLevel,
    behindPercent: number | null,
  ): Promise<boolean> {
    if (!enrolment.apprenticeUserId) {
      this.logger.debug(
        `Skipping OTJ pace notification for enrolment ${enrolment.id}: no apprentice user linked`,
      );
      return false;
    }

    const title =
      level === OtjPaceAlertLevel.OFF_TRACK
        ? 'OTJ pace critically behind'
        : 'OTJ pace behind target';
    const body =
      behindPercent !== null
        ? `You are ${Math.round(behindPercent)}% behind the OTJ pace required for your EPA date. Log hours now to get back on track.`
        : 'Your OTJ pace is behind the target required for your EPA date. Log hours now to get back on track.';

    /**
     * Guarded, because this runs *before* the line manager alert.
     *
     * It used to be unguarded: a failed apprentice notification propagated out
     * of `notifyPaceAlert`, so `notifyLineManagerOfPace` never ran and the
     * F1.2.4 AC4 email was never enqueued. One recipient's in-app notification
     * failing silenced a different recipient's email — and in the cron sweep it
     * aborted the enrolment mid-evaluation.
     *
     * The flag itself is persisted by the caller either way, so returning
     * `false` here reports "not delivered" without pretending nothing happened.
     */
    try {
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
    } catch (error) {
      this.logger.warn(
        `OTJ pace apprentice notification failed for enrolment ${enrolment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    return true;
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
  ): Promise<boolean> {
    const managerUserId = enrolment.employerManagerUserId;
    if (!managerUserId) {
      this.logger.debug(
        `Skipping OTJ pace manager alert for enrolment ${enrolment.id}: no line manager linked`,
      );
      return false;
    }

    const critical = level === OtjPaceAlertLevel.OFF_TRACK;
    const apprenticeName = await this.apprenticeNameFor(enrolment);
    const percentLabel =
      behindPercent !== null
        ? `${Math.round(behindPercent)}%`
        : 'significantly';

    /**
     * Two channels, two try blocks, deliberately.
     *
     * These used to share one: the in-app notification, the manager lookup and
     * the email were all inside a single `try`, so a failed notification write
     * jumped straight to the catch and the email was never enqueued. F1.2.4 AC4
     * requires the email, and says nothing about the in-app notification —
     * F3.4.3 Notification Centre is a separate feature. One channel failing
     * must not silence the other.
     */
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
    } catch (error) {
      this.logger.warn(
        `OTJ pace manager notification failed for enrolment ${enrolment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let emailQueued = false;
    try {
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
        emailQueued = true;
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

    /**
     * Reports what actually happened. This used to `return true` unconditionally
     * under a comment claiming it "reported as delivered=false so the caller
     * does not stamp success" — the comment described the behaviour the caller
     * needed and the code did the opposite, so a manager with no email address,
     * or a mail outage, still stamped `otjPaceAlertedAt` as though the alert
     * had landed.
     */
    return emailQueued;
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
