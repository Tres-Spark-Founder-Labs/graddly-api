import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import {
  runWithTenantContext,
  withRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';

/** F3.1.4 AC4: "has not logged any OTJ in the last 7 days". */
export const OTJ_INACTIVITY_DAYS = 7;

/** Where a tap on the alert lands: the OTJ log page with the form open (AC5). */
export const OTJ_INACTIVITY_CTA_PATH = '/otj-logs?log=1';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IOtjInactivitySweepResult {
  /** Apprentices with at least one active enrolment and a portal account. */
  checked: number;
  /** Apprentices with no entry logged in the window. */
  inactive: number;
  /** Alerts sent this run (in-app; push where the apprentice opted in). */
  alerted: number;
  /** Inactive apprentices skipped because they were alerted within the week. */
  alreadyAlerted: number;
  /** Alerts that reached a push subscription. */
  pushed: number;
}

/**
 * F3.1.4 AC4 — the seven-day inactivity alert.
 *
 * Per apprentice, not per enrolment: a person on two active programmes who
 * has logged nothing is one person to nudge once. "Logged" is the act — an
 * entry *created* in the window, whatever `loggedDate` it carries — so an
 * apprentice who catches up on last week today has logged this week.
 *
 * Once per apprentice per week (AC6 — "recur each week until pace is
 * restored"), never once per run: the sweep runs daily and
 * `enrolments.otjInactivityAlertedAt` records the last alert, the same
 * device the pace alert uses. An apprentice who logs again is not alerted
 * until they have been quiet for seven days more.
 *
 * In-app always (F3.4.3 AC1); push through the send-time preference check
 * (F3.4.3 AC3/AC4) to whichever browsers the apprentice opted in on. Both
 * carry the CTA into the log form (AC5).
 *
 * Runs from the worker with no organisation of its own, so the sweep reads
 * under the bootstrap rule (`otj-pace.service.ts` has the account of why) and
 * enters each apprentice's organisation to write.
 */
@Injectable()
export class OtjInactivityService {
  private readonly logger = new Logger(OtjInactivityService.name);

  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async alertInactiveApprentices(
    now: Date = new Date(),
  ): Promise<IOtjInactivitySweepResult> {
    const result: IOtjInactivitySweepResult = {
      checked: 0,
      inactive: 0,
      alerted: 0,
      alreadyAlerted: 0,
      pushed: 0,
    };
    const windowStart = new Date(now.getTime() - OTJ_INACTIVITY_DAYS * DAY_MS);

    const active = await withRlsBootstrap(() =>
      this.enrolmentRepo.find({
        where: { status: EnrolmentStatus.ACTIVE, isDeleted: false },
        order: { activatedAt: 'DESC' },
      }),
    );

    // One group per apprentice account; an enrolment with none has nobody
    // to nudge yet (F1.2.5 — the profile exists before the login).
    const byApprentice = new Map<string, Enrolment[]>();
    for (const enrolment of active) {
      if (!enrolment.apprenticeUserId) continue;
      const list = byApprentice.get(enrolment.apprenticeUserId) ?? [];
      list.push(enrolment);
      byApprentice.set(enrolment.apprenticeUserId, list);
    }
    result.checked = byApprentice.size;

    for (const [apprenticeUserId, enrolments] of byApprentice) {
      const enrolmentIds = enrolments.map((e) => e.id);

      const recentEntries = await withRlsBootstrap(() =>
        this.otjRepo.count({
          where: {
            enrolmentId: In(enrolmentIds),
            isDeleted: false,
            createdAt: MoreThanOrEqual(windowStart),
          },
        }),
      );
      if (recentEntries > 0) continue;
      result.inactive += 1;

      const lastAlert = enrolments
        .map((e) => e.otjInactivityAlertedAt?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0);
      if (lastAlert >= windowStart.getTime()) {
        result.alreadyAlerted += 1;
        continue;
      }

      // The most recently activated enrolment carries the alert.
      const enrolment = enrolments[0];
      try {
        const pushed = await runWithTenantContext(
          {
            label: `otj-inactivity:${enrolment.id}`,
            organisationId: enrolment.organisationId,
            userId: apprenticeUserId,
          },
          () => this.alert(enrolment, apprenticeUserId, now),
        );
        result.alerted += 1;
        if (pushed) result.pushed += 1;
      } catch (error) {
        this.logger.warn(
          `OTJ inactivity alert failed for enrolment ${enrolment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }

  /** In-app, then push; the stamp is written only once the in-app row landed. */
  private async alert(
    enrolment: Enrolment,
    apprenticeUserId: string,
    now: Date,
  ): Promise<boolean> {
    const title = 'No off-the-job hours logged this week';
    const body =
      `It has been ${OTJ_INACTIVITY_DAYS} days since you last logged a ` +
      'session. Log one now to keep on pace for your EPA.';

    /**
     * Null when the apprentice is not yet a member (F1.2.5). The comment on
     * this method already said the stamp is written "only once the in-app row
     * landed"; it was not checked, so an invited-but-not-joined apprentice was
     * stamped and then not alerted again for the whole inactivity window.
     */
    const notification = await this.notificationsService.createForUser({
      userId: apprenticeUserId,
      organisationId: enrolment.organisationId,
      type: NotificationType.OTJ,
      title,
      body,
      metadata: {
        enrolmentId: enrolment.id,
        action: 'log_otj',
        ctaPath: OTJ_INACTIVITY_CTA_PATH,
        daysInactive: OTJ_INACTIVITY_DAYS,
      },
    });

    const { outcome } = await this.notificationsService.sendPush({
      userId: apprenticeUserId,
      type: NotificationType.OTJ,
      payload: {
        title,
        body,
        url: OTJ_INACTIVITY_CTA_PATH,
        tag: 'otj-inactivity',
      },
    });

    // One channel is enough to count as alerted; neither leaves the
    // apprentice eligible on the next sweep rather than stamped in silence.
    const reached = notification !== null || outcome === 'sent';
    if (reached) {
      enrolment.otjInactivityAlertedAt = now;
      await withRlsBootstrap(() =>
        this.enrolmentRepo.update(enrolment.id, {
          otjInactivityAlertedAt: now,
        }),
      );
    }

    return outcome === 'sent';
  }
}
