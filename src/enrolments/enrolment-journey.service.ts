import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';
import {
  computeOtjPaceSnapshot,
  computeOtjPercentOfTarget,
} from '../otj/otj-pace-calculator.js';
import {
  computeOtjProgressBand,
  computeProjectedCompletionDate,
} from '../otj/otj-progress.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { DEFAULT_GATEWAY_CRITERIA } from './constants/default-gateway-criteria.js';
import { EnrolmentsService } from './enrolments.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { GatewayCriterionStatus } from './enums/gateway-criterion-status.enum.js';
import { JourneyMilestoneStatus } from './enums/journey-milestone-status.enum.js';
import { computeDaysToEpa, computeEpaCountdownBand } from './epa-countdown.js';

import type { EnrolmentJourneyResponseDto } from './dto/enrolment-journey-response.dto.js';
import type { UpdateEnrolmentJourneyDto } from './dto/update-enrolment-journey.dto.js';
import type { GatewayCriterionDefinition } from './types/gateway-criteria.types.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class EnrolmentJourneyService {
  constructor(
    private readonly enrolmentsService: EnrolmentsService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getJourney(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<EnrolmentJourneyResponseDto> {
    const enrolment = await this.enrolmentsService.findOne(user, enrolmentId);
    const journey = await this.buildJourney(enrolment);
    await this.reconcileGatewayReadiness(enrolment, journey.gatewayReady);
    /**
     * Re-read after reconciling: the call above may have just stamped the
     * readiness moment, and a response that omitted it would show a "Gateway
     * Ready" badge with no date on the very read that created it.
     */
    journey.gatewayReadyAt = enrolment.gatewayReadyAt;
    return journey;
  }

  /** Provider ops: gateway % without side effects (no gateway-ready notification). */
  async getGatewayCompletionPercent(enrolment: Enrolment): Promise<number> {
    const journey = await this.buildJourney(enrolment);
    return journey.gatewayCompletionPercent;
  }

  async updateJourney(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: UpdateEnrolmentJourneyDto,
  ): Promise<EnrolmentJourneyResponseDto> {
    const enrolment = await this.enrolmentsService.findOne(user, enrolmentId);

    let changed = false;
    if (dto.epaDate !== undefined) {
      enrolment.epaDate = dto.epaDate;
      changed = true;
    }
    // F2.2.4 AC1 — the EPAO, set at the same point in the journey as the date.
    // Empty string clears, so a wrongly-entered EPAO can be removed rather
    // than only overwritten.
    if (dto.epaOrganisationName !== undefined) {
      enrolment.epaOrganisationName = dto.epaOrganisationName.trim() || null;
      changed = true;
    }
    if (dto.epaOrganisationUkprn !== undefined) {
      enrolment.epaOrganisationUkprn = dto.epaOrganisationUkprn.trim() || null;
      changed = true;
    }

    if (changed) {
      await this.enrolmentRepo.save(enrolment);
    }
    return this.buildJourney(enrolment);
  }

  private async buildJourney(
    enrolment: Enrolment,
  ): Promise<EnrolmentJourneyResponseDto> {
    const organisationId = enrolment.organisationId;
    /**
     * One instant for the whole response. Taken once so the countdown, the
     * overdue reviews and the gateway milestone cannot disagree about what
     * "today" is — a request spanning midnight would otherwise be able to
     * report a review as overdue while the countdown still counted the day it
     * was due.
     */
    const now = new Date();
    const [standard, approvedMinutes, commitmentSigned, reviewsCurrent] =
      await Promise.all([
        this.standardRepo.findOne({
          where: { id: enrolment.standardId, organisationId },
        }),
        this.sumApprovedMinutes(enrolment.id, organisationId),
        this.hasSignedCommitment(enrolment.id, organisationId),
        this.areReviewsCurrent(enrolment.id, organisationId),
      ]);

    const paceSnapshot = computeOtjPaceSnapshot({
      plannedDurationMonths: enrolment.plannedDurationMonths,
      plannedStartDate: enrolment.plannedStartDate,
      plannedEndDate: enrolment.plannedEndDate,
      activatedAt: enrolment.activatedAt,
      epaDate: enrolment.epaDate,
      approvedMinutes,
    });

    /**
     * F3.1.2 AC1 — reuses the existing percent-of-target helper rather than
     * dividing here. That function is the single home for the calculation and
     * is approved-only per client decision D2.
     */
    const percentOfTarget = computeOtjPercentOfTarget(
      enrolment.plannedDurationMonths,
      approvedMinutes,
    );

    const criteriaDefs = this.resolveGatewayCriteria(standard);
    const criterionCompletion = new Map<string, boolean>([
      [
        'otj_on_track',
        paceSnapshot.alertLevel === OtjPaceAlertLevel.ON_TRACK ||
          paceSnapshot.alertLevel === OtjPaceAlertLevel.AT_RISK,
      ],
      ['commitment_signed', commitmentSigned],
      ['reviews_current', reviewsCurrent],
      ['epa_date_confirmed', enrolment.epaDate !== null],
    ]);

    const gatewayChecklist = criteriaDefs.map((criterion) =>
      this.mapCriterion(criterion, criterionCompletion),
    );
    const completeCount = gatewayChecklist.filter(
      (item) => item.status === GatewayCriterionStatus.COMPLETE,
    ).length;
    const gatewayCompletionPercent =
      criteriaDefs.length > 0
        ? Math.round((completeCount / criteriaDefs.length) * 100)
        : 0;
    /**
     * Counted, not derived from the rounded percentage.
     *
     * This is defensive rather than a fix for a live defect: `Math.round`
     * reaches 100 from 99.5, but only the four codes in `criterionCompletion`
     * can ever evaluate complete, so today the percentage cannot round to 100
     * with a criterion outstanding. That safety is incidental — it depends on
     * the completion map staying small, not on anything stated — while
     * `standards.gatewayCriteria` is client-configurable and this boolean
     * gates a recorded moment and the notification that puts an apprentice
     * forward for EPA nomination. Counting says what is meant directly.
     */
    const gatewayReady =
      criteriaDefs.length > 0 && completeCount === criteriaDefs.length;

    const milestones = await this.buildMilestones(
      enrolment,
      organisationId,
      gatewayReady,
      now,
    );

    return {
      enrolmentId: enrolment.id,
      epaDate: enrolment.epaDate,
      // F2.2.4 AC1 — echoed back so a save can be seen to have landed.
      epaOrganisationName: enrolment.epaOrganisationName,
      epaOrganisationUkprn: enrolment.epaOrganisationUkprn,
      daysToEpa: computeDaysToEpa(enrolment.epaDate, now),
      epaCountdownBand: computeEpaCountdownBand({
        epaDate: enrolment.epaDate,
        completedAt: enrolment.completedAt,
        now,
      }),
      milestones,
      gatewayChecklist,
      gatewayCompletionPercent,
      gatewayReady,
      gatewayReadyAt: enrolment.gatewayReadyAt,
      pace: {
        alertLevel: paceSnapshot.alertLevel,
        behindPercent: paceSnapshot.behindPercent,
        requiredWeeklyHours: paceSnapshot.requiredWeeklyHours,
        approvedMinutes: paceSnapshot.approvedMinutes,
        expectedMinutesByToday: paceSnapshot.expectedMinutesByToday,
        totalTargetMinutes: paceSnapshot.totalTargetMinutes,
        percentOfTarget,
        progressBand: computeOtjProgressBand(percentOfTarget),
        projectedCompletionDate: computeProjectedCompletionDate({
          approvedMinutes: paceSnapshot.approvedMinutes,
          totalTargetMinutes: paceSnapshot.totalTargetMinutes,
          startDate: enrolment.activatedAt ?? enrolment.plannedStartDate,
          now,
        }),
      },
    };
  }

  private resolveGatewayCriteria(
    standard: Standard | null,
  ): GatewayCriterionDefinition[] {
    const raw = standard?.gatewayCriteria;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw
        .map((item) => item as GatewayCriterionDefinition)
        .filter((item) => item.code && item.title);
    }
    return DEFAULT_GATEWAY_CRITERIA;
  }

  private mapCriterion(
    criterion: GatewayCriterionDefinition,
    completion: Map<string, boolean>,
  ) {
    const blockedBy =
      criterion.dependsOn?.filter((code) => !completion.get(code)) ?? [];
    if (blockedBy.length > 0) {
      return {
        code: criterion.code,
        title: criterion.title,
        description: criterion.description,
        status: GatewayCriterionStatus.BLOCKED,
        blockedBy,
      };
    }
    if (completion.get(criterion.code)) {
      return {
        code: criterion.code,
        title: criterion.title,
        description: criterion.description,
        status: GatewayCriterionStatus.COMPLETE,
      };
    }
    return {
      code: criterion.code,
      title: criterion.title,
      description: criterion.description,
      status: GatewayCriterionStatus.NOT_STARTED,
    };
  }

  private async buildMilestones(
    enrolment: Enrolment,
    organisationId: string,
    gatewayReady: boolean,
    now: Date,
  ) {
    /**
     * Client decision Q2 — the timeline shows the reviews that actually exist
     * for this enrolment, not a schedule derived from the start date. Late,
     * rescheduled and missed reviews therefore appear as they really are. The
     * timeline is untidier for it, and that untidiness is the point: it is the
     * signal that something has slipped.
     */
    const reviews = await this.reviewRepo.find({
      where: { enrolmentId: enrolment.id, organisationId, isDeleted: false },
      order: { scheduledAt: 'ASC' },
    });

    const milestones = [
      this.milestone(
        'enrolment',
        'Enrolment',
        'Apprenticeship enrolment activated',
        enrolment.activatedAt
          ? enrolment.activatedAt.toISOString().slice(0, 10)
          : null,
        enrolment.activatedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'induction',
        'Induction',
        'Programme induction completed',
        enrolment.plannedStartDate,
        enrolment.activatedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      ...reviews.map((review, index) =>
        this.milestone(
          `review_${index + 1}`,
          review.title ?? '12-weekly review',
          review.reviewType,
          review.scheduledAt.toISOString().slice(0, 10),
          this.reviewMilestoneStatus(review, now),
        ),
      ),
      this.milestone(
        'gateway',
        'Gateway',
        'Gateway readiness checklist complete',
        gatewayReady ? new Date().toISOString().slice(0, 10) : null,
        gatewayReady
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'epa',
        'End-point assessment',
        'EPA window',
        enrolment.epaDate,
        enrolment.epaDate
          ? JourneyMilestoneStatus.CURRENT
          : JourneyMilestoneStatus.UPCOMING,
      ),
      this.milestone(
        'completion',
        'Completion',
        'Apprenticeship completed',
        enrolment.completedAt
          ? enrolment.completedAt.toISOString().slice(0, 10)
          : null,
        enrolment.completedAt
          ? JourneyMilestoneStatus.COMPLETE
          : JourneyMilestoneStatus.UPCOMING,
      ),
    ];

    if (!milestones.some((m) => m.status === JourneyMilestoneStatus.CURRENT)) {
      const firstUpcoming = milestones.find(
        (m) => m.status === JourneyMilestoneStatus.UPCOMING,
      );
      if (firstUpcoming) {
        firstUpcoming.status = JourneyMilestoneStatus.CURRENT;
      }
    }

    return milestones;
  }

  /**
   * Client decision Q2 — a review's milestone status reflects what happened to
   * it, and its follow-up: a review whose date has passed without being held
   * is marked overdue rather than silently left as an unticked box.
   *
   * The previous mapping had two faults this replaces. Every review that was
   * neither completed nor cancelled was reported as `current`, so an
   * apprentice with six scheduled reviews saw six simultaneous "current"
   * stages; and a *cancelled* review was reported as `upcoming`, which told
   * the apprentice a review was still to come when it had been called off.
   */
  private reviewMilestoneStatus(
    review: Review,
    now: Date,
  ): JourneyMilestoneStatus {
    if (review.status === ReviewStatus.COMPLETED) {
      return JourneyMilestoneStatus.COMPLETE;
    }
    if (review.status === ReviewStatus.CANCELLED) {
      return JourneyMilestoneStatus.CANCELLED;
    }
    return review.scheduledAt.getTime() < now.getTime()
      ? JourneyMilestoneStatus.OVERDUE
      : JourneyMilestoneStatus.UPCOMING;
  }

  private milestone(
    code: string,
    title: string,
    description: string | null,
    date: string | null,
    status: JourneyMilestoneStatus,
  ) {
    return { code, title, description, date, status };
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

  private async hasSignedCommitment(
    enrolmentId: string,
    organisationId: string,
  ): Promise<boolean> {
    const group = await this.commitmentGroupRepo.findOne({
      where: { enrolmentId, organisationId, isDeleted: false },
      relations: ['currentVersion'],
    });
    let statement = group?.currentVersion ?? null;
    if (!statement && group?.currentVersionId) {
      statement = await this.commitmentRepo.findOne({
        where: { id: group.currentVersionId },
      });
    }
    return statement?.status === CommitmentStatementStatus.SIGNED;
  }

  private async areReviewsCurrent(
    enrolmentId: string,
    organisationId: string,
  ): Promise<boolean> {
    const overdue = await this.reviewRepo
      .createQueryBuilder('review')
      .where('review.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('review.organisationId = :organisationId', { organisationId })
      .andWhere('review.isDeleted = false')
      .andWhere('review.status NOT IN (:...done)', {
        done: [ReviewStatus.COMPLETED, ReviewStatus.CANCELLED],
      })
      .andWhere('review.scheduledAt < :now', { now: new Date() })
      .getCount();
    return overdue === 0;
  }

  /**
   * F3.2.2 AC5, client decision Q3 — gateway readiness is a moment that gets
   * recorded, not a value recomputed and forgotten on each render.
   *
   * ── WHY TWO COLUMNS ──────────────────────────────────────────────────────
   *
   * `gatewayReadyAt` is when readiness was reached. `gatewayReadyNotifiedAt`
   * is whether the provider has been told. Collapsing them loses the ability
   * to retry a notification that failed: if the only marker were "notified",
   * a dispatch that threw would leave no record that readiness had happened,
   * and the next read would re-notify from scratch — or, worse, the marker
   * would be set first and the notification lost silently.
   *
   * ── DECISION Q3a — READINESS CAN LAPSE ───────────────────────────────────
   *
   * If a criterion is later withdrawn or invalidated, both columns clear, the
   * badge disappears, and the apprentice's screen reflects the current
   * position rather than a high-water mark. The client accepted that an
   * apprentice may see a badge appear and later disappear.
   *
   * ── DECISION Q3b — A SECOND READINESS RE-NOTIFIES ────────────────────────
   *
   * Because the lapse clears `gatewayReadyNotifiedAt` too, regaining
   * readiness sends a fresh notification. That is deliberate: if the first
   * notification led to no action because readiness lapsed, only a second one
   * reopens it.
   *
   * ── KNOWN LIMITATION, RECORDED RATHER THAN HIDDEN ────────────────────────
   *
   * This runs on read. Nothing observes readiness until someone opens the
   * journey, so `gatewayReadyAt` is "when readiness was first seen", not
   * "when the last criterion was met" — for an apprentice whose screen goes
   * unopened for a week, those differ by a week. Closing that gap needs a
   * sweep like `otj-pace-cron.service.ts`, which is scoped in
   * OPEN_QUESTIONS.md rather than smuggled in here.
   */
  private async reconcileGatewayReadiness(
    enrolment: Enrolment,
    gatewayReady: boolean,
  ): Promise<void> {
    if (gatewayReady) {
      if (!enrolment.gatewayReadyAt) {
        enrolment.gatewayReadyAt = new Date();
        await this.enrolmentRepo.save(enrolment);
      }

      if (!enrolment.gatewayReadyNotifiedAt) {
        const providerOrgId =
          enrolment.providerOrganisationId ?? enrolment.organisationId;
        await this.notifyOrganisationAdmins(providerOrgId, enrolment.id);
        enrolment.gatewayReadyNotifiedAt = new Date();
        await this.enrolmentRepo.save(enrolment);
      }
      return;
    }

    if (enrolment.gatewayReadyAt || enrolment.gatewayReadyNotifiedAt) {
      enrolment.gatewayReadyAt = null;
      enrolment.gatewayReadyNotifiedAt = null;
      await this.enrolmentRepo.save(enrolment);
    }
  }

  private async notifyOrganisationAdmins(
    organisationId: string,
    enrolmentId: string,
  ): Promise<void> {
    const owners = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.OWNER,
      },
      relations: ['user'],
    });
    const admins = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.ADMIN,
      },
      relations: ['user'],
    });

    const notified = new Set<string>();
    for (const membership of [...owners, ...admins]) {
      const userId = membership.user.id;
      if (notified.has(userId)) {
        continue;
      }
      notified.add(userId);
      await this.notificationsService.createForUser({
        userId,
        organisationId,
        type: NotificationType.GENERIC,
        title: 'Apprentice gateway ready',
        body: 'An apprentice has completed all gateway readiness criteria.',
        metadata: { enrolmentId, action: 'gateway_ready' },
      });
    }
  }
}
