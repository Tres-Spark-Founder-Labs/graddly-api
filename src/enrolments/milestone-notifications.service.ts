import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  runWithTenantContext,
  withRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentMilestoneNotification } from './entities/enrolment-milestone-notification.entity.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';
import { JourneyMilestoneStatus } from './enums/journey-milestone-status.enum.js';
import { MilestoneNotificationOutcome } from './enums/milestone-notification-outcome.enum.js';

export interface IMilestoneSweepResult {
  enrolmentsChecked: number;
  seeded: number;
  notified: number;
  unreached: number;
}

/**
 * The milestones whose completion is never announced.
 *
 * The learner's own enrolment moment already carries an invitation, an
 * account and a signature; a notification in the middle of that is noise
 * rather than news. Both are still recorded as seeded, with the reason on the
 * row, so their absence is explainable a year from now.
 */
const NEVER_ANNOUNCED = new Set(['enrolment', 'induction']);

const SEEDED_BEFORE_FIRST_SWEEP =
  'Complete before the milestone sweep first observed this enrolment; ' +
  'not announced so that shipping the sweep did not notify months of history.';

const SEEDED_BY_RULE =
  "The learner's own enrolment moment: recorded, deliberately not announced.";

/**
 * F3.4.3 AC2 — `milestone_completed`, the last of the six notification types
 * that criterion names.
 *
 * ── HOW IT DECIDES, AND WHY IT IS A SWEEP ───────────────────────────────────
 *
 * There is no milestone transition to hook: `buildMilestones` derives the
 * timeline on every read from `activatedAt`, the review rows, the gateway
 * state, `epaDate` and `completedAt`, and nothing about a milestone is
 * stored. Storing milestone status would have put a conclusion beside its own
 * inputs and required the two to be kept in agreement forever, against a
 * client decision (Q2) that the timeline is derived precisely so that late,
 * rescheduled and missed reviews show as they really are.
 *
 * So: recompute, compare against a marker per enrolment per milestone, and
 * announce the difference. The timeline is untouched and the API unchanged.
 *
 * ── WHAT A MILESTONE GOING BACKWARDS DOES: NOTHING ──────────────────────────
 *
 * A rescheduled review moves a completed review milestone back to upcoming or
 * overdue, and this sweep does **not** announce it again when it recompletes.
 * The marker is permanent.
 *
 * That is deliberately different from `reconcileGatewayReadiness` a few files
 * away, which clears `gatewayReadyAt` and `gatewayReadyNotifiedAt` when
 * readiness regresses and therefore tells the provider again when it returns.
 * The difference is what each notification is about. Gateway readiness is a
 * **state** a provider acts on, so re-entering it is worth saying again. A
 * completed milestone is an **event** in the learner's progress: saying it
 * twice implies something new happened, when the timeline already shows the
 * reschedule truthfully. If one of these two is ever changed, the other is
 * not automatically wrong — read both comments before making them agree.
 *
 * ── WHY NOTHING IS CLAIMED BEFORE IT IS SENT ────────────────────────────────
 *
 * The marker row is written only once a channel has landed. A marker written
 * first, as a claim, is what turned six emitters into permanent silence
 * before 6660672: the row suppressed every later attempt and the thing was
 * never sent. A send that reaches nobody here leaves no row, so the next
 * sweep tries again — and the row's `outcome` distinguishes "seeded, never
 * send" from "sent", with a check constraint holding `notifiedAt` to the
 * second meaning. The trade is stated plainly: if delivery lands and the
 * insert then fails, the next sweep announces once more. One extra
 * notification is the lesser fault than permanent silence.
 */
@Injectable()
export class MilestoneNotificationsService {
  private readonly logger = new Logger(MilestoneNotificationsService.name);

  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(EnrolmentMilestoneNotification)
    private readonly markerRepo: Repository<EnrolmentMilestoneNotification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly journeyService: EnrolmentJourneyService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async notifyCompletedMilestones(
    now: Date = new Date(),
  ): Promise<IMilestoneSweepResult> {
    const result: IMilestoneSweepResult = {
      enrolmentsChecked: 0,
      seeded: 0,
      notified: 0,
      unreached: 0,
    };

    /**
     * The discovery read: a cron has no organisation, and `enrolments` is
     * keyed on one. Bootstrap for this read only — the ids that leave it are
     * used to enter each enrolment's own organisation below.
     *
     * Completed enrolments are included because `completion` is a milestone;
     * `sweepEnrolment` returns early once a completed enrolment has nothing
     * left to announce, so they do not accumulate work forever.
     */
    const enrolments = await withRlsBootstrap(() =>
      this.enrolmentRepo.find({
        where: {
          isDeleted: false,
          status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.COMPLETED]),
        },
      }),
    );

    for (const enrolment of enrolments) {
      try {
        const swept = await runWithTenantContext(
          {
            label: `milestone-notifications:${enrolment.id}`,
            organisationId: enrolment.organisationId,
          },
          () => this.sweepEnrolment(enrolment, now),
        );
        result.enrolmentsChecked += 1;
        result.seeded += swept.seeded;
        result.notified += swept.notified;
        result.unreached += swept.unreached;
      } catch (error) {
        // One enrolment's failure must not cost every later enrolment its
        // notification, as in the caseload and pace sweeps.
        this.logger.warn(
          `Milestone sweep failed for enrolment ${enrolment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `Milestone sweep: ${result.enrolmentsChecked} enrolment(s), ` +
        `${result.notified} announced, ${result.seeded} seeded, ${result.unreached} reached nobody`,
    );
    return result;
  }

  /** One enrolment, inside its own organisation's context. */
  private async sweepEnrolment(
    enrolment: Enrolment,
    now: Date,
  ): Promise<{ seeded: number; notified: number; unreached: number }> {
    const counts = { seeded: 0, notified: 0, unreached: 0 };

    const markers = await this.markerRepo.find({
      where: {
        enrolmentId: enrolment.id,
        organisationId: enrolment.organisationId,
      },
      select: ['id', 'milestoneKey'],
    });
    const accountedFor = new Set(markers.map((marker) => marker.milestoneKey));

    // A finished programme with its completion announced has nothing further
    // to say; skipping it keeps the sweep's cost on the active estate.
    if (
      enrolment.status === EnrolmentStatus.COMPLETED &&
      accountedFor.has('completion')
    ) {
      return counts;
    }

    const milestones =
      await this.journeyService.milestonesForNotification(enrolment);
    const complete = milestones.filter(
      (milestone) => milestone.status === JourneyMilestoneStatus.COMPLETE,
    );

    /**
     * First observation: everything already complete is recorded without
     * being announced, and nothing is sent. This is what stops the sweep
     * greeting every existing learner with a notification per milestone they
     * finished months ago. `milestonesObservedAt` is the stamp that makes
     * "never looked at this enrolment" a fact rather than an inference from
     * an empty marker set — an enrolment with nothing complete yet would
     * otherwise look the same on its second sweep as on its first.
     */
    if (!enrolment.milestonesObservedAt) {
      for (const milestone of complete) {
        await this.record(
          enrolment,
          milestone,
          null,
          SEEDED_BEFORE_FIRST_SWEEP,
        );
        counts.seeded += 1;
      }
      enrolment.milestonesObservedAt = now;
      await this.enrolmentRepo.save(enrolment);
      return counts;
    }

    for (const milestone of complete) {
      if (accountedFor.has(milestone.notificationKey)) {
        continue;
      }

      if (NEVER_ANNOUNCED.has(milestone.notificationKey)) {
        await this.record(enrolment, milestone, null, SEEDED_BY_RULE);
        counts.seeded += 1;
        continue;
      }

      const reached = await this.announce(enrolment, milestone);
      if (!reached) {
        // No row: the milestone stays eligible for the next sweep rather
        // than being suppressed by a claim nobody received.
        this.logger.warn(
          `Milestone ${milestone.notificationKey} on enrolment ${enrolment.id} reached nobody; leaving it eligible for the next sweep`,
        );
        counts.unreached += 1;
        continue;
      }

      await this.record(enrolment, milestone, now, null);
      counts.notified += 1;
    }

    return counts;
  }

  /**
   * The apprentice, in app and by email, with the per-type preference applied
   * at send time.
   *
   * Returns whether a channel landed. The in-app row is null when the
   * apprentice holds no membership yet — the normal pre-membership state
   * (F1.2.5 AC3/AC5) — and `sendEmail` answers `suppressed` when they have
   * switched this type off, which is the preference being respected rather
   * than a delivery. Neither counts on its own, so a learner who is not yet a
   * member and has opted out of the email is tried again next sweep, and the
   * retry ends when their account joins the organisation.
   */
  private async announce(
    enrolment: Enrolment,
    milestone: { title: string; date: string | null; notificationKey: string },
  ): Promise<boolean> {
    const apprenticeUserId = enrolment.apprenticeUserId;
    if (!apprenticeUserId) {
      // Nobody to tell yet: an enrolment can name an apprentice before they
      // have an account (F1.2.5 AC1/AC3). Not an error, and not a delivery.
      return false;
    }

    const title = `Milestone complete: ${milestone.title}`;
    const body = `You have completed ${milestone.title} on your apprenticeship journey.`;

    const notification = await this.notificationsService.createForUser({
      userId: apprenticeUserId,
      organisationId: enrolment.organisationId,
      type: NotificationType.MILESTONE_COMPLETED,
      title,
      body,
      metadata: {
        enrolmentId: enrolment.id,
        milestoneKey: milestone.notificationKey,
        milestoneTitle: milestone.title,
      },
    });
    let reached = notification !== null;

    /**
     * The recipient's own record is read under the bootstrap rule: the sweep
     * has no user, and `users_select` admits only the actor or a member of
     * the current organisation. One row, two named columns, the id taken from
     * the enrolment just read.
     */
    const apprentice = await withRlsBootstrap(() =>
      this.userRepo.findOne({
        where: { id: apprenticeUserId, isDeleted: false },
        select: ['id', 'email', 'firstName'],
      }),
    );

    if (apprentice?.email) {
      const outcome = await this.notificationsService.sendEmail({
        userId: apprentice.id,
        type: NotificationType.MILESTONE_COMPLETED,
        payload: new SerializedEmailPayload(
          EmailTemplate.MILESTONE_COMPLETED,
          apprentice.email,
          {
            firstName: apprentice.firstName,
            milestoneTitle: milestone.title,
            /**
             * The milestone's own date, not when anything was edited. A
             * review's completion has no timestamp of its own — only its
             * status and the row's mutable `updatedAt` — so presenting that
             * as "the day you completed it" would be a guess. This is the
             * date the timeline shows, which for a review is the date it was
             * scheduled for.
             */
            milestoneDate: milestone.date,
            appName: this.config.get<string>('app.email.appName', 'Graddly'),
          },
        ),
      });
      if (outcome === 'queued') {
        reached = true;
      }
    }

    return reached;
  }

  private async record(
    enrolment: Enrolment,
    milestone: { date: string | null; notificationKey: string },
    notifiedAt: Date | null,
    reason: string | null,
  ): Promise<void> {
    await this.markerRepo
      .createQueryBuilder()
      .insert()
      .values({
        organisationId: enrolment.organisationId,
        enrolmentId: enrolment.id,
        milestoneKey: milestone.notificationKey,
        outcome: notifiedAt
          ? MilestoneNotificationOutcome.NOTIFIED
          : MilestoneNotificationOutcome.SEEDED,
        completedOn: milestone.date,
        notifiedAt,
        reason,
      })
      // The unique index is the backstop if two sweeps ever overlap: the
      // second insert is dropped rather than failing the sweep.
      .orIgnore()
      .execute();
  }
}
