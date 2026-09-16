import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EnrolmentJourneyService } from '../enrolments/enrolment-journey.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import {
  InterventionFlagReason,
  computeInterventionSeverity,
  deriveLearnerStatusBadge,
  isGatewayStalled,
  isReviewOverdueByPrd,
} from './utils/learner-status-badge.util.js';

export interface IEnrolmentProviderContext {
  enrolment: Enrolment;
  gatewayCompletionPercent: number;
  hasOverdueReview: boolean;
  nextReviewDate: Date | null;
  daysSinceLastActivity: number;
  flagReasons: InterventionFlagReason[];
  severityScore: number;
  statusBadge: ReturnType<typeof deriveLearnerStatusBadge>;
}

@Injectable()
export class LearnerMetricsService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(MessageThread)
    private readonly threadRepo: Repository<MessageThread>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    private readonly journeyService: EnrolmentJourneyService,
  ) {}

  async loadActiveEnrolments(organisationId: string): Promise<Enrolment[]> {
    return this.enrolmentRepo.find({
      where: {
        organisationId,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
      relations: ['apprentice', 'standard', 'employerOrganisation'],
      order: { createdAt: 'DESC' },
    });
  }

  async buildContext(
    enrolment: Enrolment,
    organisationId: string,
  ): Promise<IEnrolmentProviderContext> {
    const [gatewayCompletionPercent, reviewStats, daysSinceLastActivity] =
      await Promise.all([
        this.journeyService.getGatewayCompletionPercent(enrolment),
        this.loadReviewStats(enrolment.id, organisationId),
        this.computeDaysSinceLastActivity(enrolment.id, organisationId),
      ]);

    const otjLevel = enrolment.otjPaceAlertLevel;
    const flagReasons = this.buildFlagReasons({
      otjLevel,
      hasOverdueReview: reviewStats.hasOverdue,
      gatewayStalled: isGatewayStalled(
        enrolment.epaDate,
        gatewayCompletionPercent,
      ),
    });

    const severityScore = computeInterventionSeverity({
      otjOffTrack: otjLevel === OtjPaceAlertLevel.OFF_TRACK,
      reviewOverdue: reviewStats.hasOverdue,
      gatewayStalled: flagReasons.includes(
        InterventionFlagReason.GATEWAY_STALLED,
      ),
      otjAtRisk: otjLevel === OtjPaceAlertLevel.AT_RISK,
    });

    const statusBadge = deriveLearnerStatusBadge({
      apprenticeStatus: enrolment.apprentice?.status ?? ApprenticeStatus.ACTIVE,
      enrolmentStatus: enrolment.status,
      otjPaceAlertLevel: otjLevel,
      gatewayCompletionPercent,
      hasOverdueReview: reviewStats.hasOverdue,
    });

    return {
      enrolment,
      gatewayCompletionPercent,
      hasOverdueReview: reviewStats.hasOverdue,
      nextReviewDate: reviewStats.nextScheduled,
      daysSinceLastActivity,
      flagReasons,
      severityScore,
      statusBadge,
    };
  }

  /**
   * Tutor display names, by user id.
   *
   * ── WHY THIS READS UNDER THE BOOTSTRAP FLAG ───────────────────────────────
   *
   * F1.2.2 AC1 names the tutor among the personal details the employer's
   * learner profile must show. The tutor is a member of the *provider's*
   * organisation, and `users_select` admits a row only on
   * `app_rls_bootstrap() OR id = app_current_user() OR
   * app_user_in_current_org(id)` — so for an employer caller the row is not
   * visible, and `tutor.name` came back null beside a non-null
   * `tutor.userId`.
   *
   * Hydrating under the bootstrap flag was chosen over two alternatives, both
   * rejected on the record:
   *
   *   SECURITY DEFINER  a new mechanism disclosing strictly less than the
   *                     employer already receives. `GET /enrolments` serves
   *                     them `tutorUserDisplayName` — "First Last (email)" —
   *                     from `enrichEnrolmentsForDisplay`, which hydrates
   *                     under this same flag. A function written to guard a
   *                     name that is already published one endpoint over
   *                     guards nothing.
   *   denormalising     a name column on `enrolments` is a second write path
   *                     to keep in step with `assignTutorInBulk` and every
   *                     future writer of `tutorUserId`, for a field the
   *                     aggregate can read directly. Stale names are the
   *                     failure mode, and they are silent.
   *
   * `loadEmployerContacts` below has the same shape for the same reason — the
   * employer's own contact is not a member of the provider's organisation
   * either. Two call sites that agree are not a pattern, so the rule is
   * written down: `docs/employer-learner-access.md`, "Bootstrap is for
   * display names".
   *
   * ── WHAT THE FLAG DOES NOT DO ─────────────────────────────────────────────
   *
   * It does not scope the read. Under bootstrap `users_select` matches on the
   * id alone, so the ids passed in are the whole of the access decision and
   * must come from rows the caller may already read. Every caller derives them
   * from enrolments it has just read under its own policy — the profile
   * aggregate from the one enrolment, the cohort, queue and caseload screens
   * from the page of enrolments they have listed.
   *
   * `select` is the display fields and nothing else: three, not the four
   * `enrichEnrolmentsForDisplay` uses, because its labels carry the email and
   * the tutor DTO is `{ userId, name }`. A `User` row also carries
   * `password` and `mfaSecret`, kept off the wire by `select: false` — an
   * ORM convention guarding a database boundary, and this read does not lean
   * on it.
   */
  async loadTutorNames(tutorUserIds: string[]): Promise<Map<string, string>> {
    if (tutorUserIds.length === 0) {
      return new Map();
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const users = await this.userRepo.find({
        where: { id: In(tutorUserIds) },
        select: ['id', 'firstName', 'lastName'],
      });
      return new Map(
        users.map((user) => [
          user.id,
          `${user.firstName} ${user.lastName}`.trim(),
        ]),
      );
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  /**
   * F1.2.2 AC1 — the provider's name on the employer's screen.
   *
   * The same read `enrichEnrolmentsForDisplay` has always made for the
   * roster, and the same rule as `loadTutorNames`: `organisations_select`
   * admits members only (1780500000006), so an employer cannot read the
   * provider's row under its own policy, and the label is hydrated under the
   * bootstrap flag instead. Ids come from an enrolment the caller has just
   * read; the select is the label and nothing else — never the UKPRN, never
   * an address, never the row.
   */
  async loadOrganisationNames(
    organisationIds: string[],
  ): Promise<Map<string, string>> {
    if (organisationIds.length === 0) {
      return new Map();
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisations = await this.organisationRepo.find({
        where: { id: In(organisationIds), isDeleted: false },
        select: ['id', 'name'],
      });
      return new Map(
        organisations.map((organisation) => [
          organisation.id,
          organisation.name,
        ]),
      );
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  async loadEmployerContacts(
    employerOrgIds: string[],
  ): Promise<
    Map<string, { contactName: string | null; contactEmail: string | null }>
  > {
    if (employerOrgIds.length === 0) {
      return new Map();
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const memberships = await this.membershipRepo.find({
        where: {
          organisation: { id: In(employerOrgIds) },
          role: OrganisationRole.OWNER,
          isDeleted: false,
        },
        relations: ['user', 'organisation'],
      });

      const map = new Map<
        string,
        { contactName: string | null; contactEmail: string | null }
      >();
      for (const membership of memberships) {
        map.set(membership.organisation.id, {
          contactName:
            `${membership.user.firstName} ${membership.user.lastName}`.trim(),
          contactEmail: membership.user.email,
        });
      }
      return map;
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private buildFlagReasons(input: {
    otjLevel: OtjPaceAlertLevel | null;
    hasOverdueReview: boolean;
    gatewayStalled: boolean;
  }): InterventionFlagReason[] {
    const reasons: InterventionFlagReason[] = [];
    if (
      input.otjLevel === OtjPaceAlertLevel.AT_RISK ||
      input.otjLevel === OtjPaceAlertLevel.OFF_TRACK
    ) {
      reasons.push(InterventionFlagReason.OTJ_BEHIND);
    }
    if (input.hasOverdueReview) {
      reasons.push(InterventionFlagReason.MISSED_REVIEW);
    }
    if (input.gatewayStalled) {
      reasons.push(InterventionFlagReason.GATEWAY_STALLED);
    }
    return reasons;
  }

  private async loadReviewStats(
    enrolmentId: string,
    organisationId: string,
  ): Promise<{ hasOverdue: boolean; nextScheduled: Date | null }> {
    const reviews = await this.reviewRepo.find({
      where: { enrolmentId, organisationId, isDeleted: false },
      order: { scheduledAt: 'ASC' },
    });

    const now = new Date();
    let hasOverdue = false;
    let nextScheduled: Date | null = null;

    for (const review of reviews) {
      if (isReviewOverdueByPrd(review.scheduledAt, review.status, now)) {
        hasOverdue = true;
      }
      if (
        review.status === ReviewStatus.SCHEDULED &&
        review.scheduledAt > now &&
        !nextScheduled
      ) {
        nextScheduled = review.scheduledAt;
      }
    }

    return { hasOverdue, nextScheduled };
  }

  private async computeDaysSinceLastActivity(
    enrolmentId: string,
    organisationId: string,
  ): Promise<number> {
    const now = Date.now();
    const candidates: number[] = [];

    const latestOtj = await this.otjRepo.findOne({
      where: { enrolmentId, organisationId, isDeleted: false },
      order: { updatedAt: 'DESC' },
    });
    if (latestOtj) {
      candidates.push(latestOtj.updatedAt.getTime());
    }

    const latestReview = await this.reviewRepo.findOne({
      where: { enrolmentId, organisationId, isDeleted: false },
      order: { updatedAt: 'DESC' },
    });
    if (latestReview) {
      candidates.push(latestReview.updatedAt.getTime());
    }

    const threads = await this.threadRepo.find({
      where: { enrolmentId, organisationId, isDeleted: false },
      select: ['id'],
    });
    if (threads.length > 0) {
      const latestMessage = await this.messageRepo
        .createQueryBuilder('message')
        .where('message.threadId IN (:...threadIds)', {
          threadIds: threads.map((t) => t.id),
        })
        .andWhere('message.isDeleted = false')
        .orderBy('message.createdAt', 'DESC')
        .getOne();
      if (latestMessage) {
        candidates.push(latestMessage.createdAt.getTime());
      }
    }

    if (candidates.length === 0) {
      return 0;
    }

    const latest = Math.max(...candidates);
    return Math.floor((now - latest) / (1000 * 60 * 60 * 24));
  }
}
