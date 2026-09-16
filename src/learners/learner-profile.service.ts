import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import { BreakInLearningService } from '../enrolments/break-in-learning.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewSignatureStatus } from '../reviews/enums/review-signature-status.enum.js';
import { ReviewSignerParty } from '../reviews/enums/review-signer-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import { LearnerOtjWeeklyResponseDto } from './dto/learner-otj-weekly-response.dto.js';
import { LearnerProfileResponseDto } from './dto/learner-profile-response.dto.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import {
  buildWeeklyBuckets,
  type IOtjWeeklyRow,
} from './otj-weekly-buckets.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.2.4 AC3 vs AC7. "All sessions submitted" against "loads within two
 * seconds": a weekly log over two years is a few hundred entries, which the
 * profile carries comfortably. The cap exists so one pathological account
 * cannot blow the budget, and the response says when it has bitten.
 */
const LEARNER_PROFILE_OTJ_LIMIT = 500;

@Injectable()
export class LearnerProfileService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewSignature)
    private readonly signatureRepo: Repository<ReviewSignature>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly documentsService: LearnerDocumentsService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    private readonly metricsService: LearnerMetricsService,
    private readonly interventionActionsService: InterventionActionsService,
    private readonly breakInLearningService: BreakInLearningService,
    private readonly messageThreadsService: MessageThreadsService,
  ) {}

  /**
   * The enrolment this caller is entitled to read, or a 404.
   *
   * ── WHO IS ADMITTED ─────────────────────────────────────────────────────────
   *
   * Two parties, and no others: the provider that owns the enrolment, and the
   * employer named on it. F1.2.2 Individual Learner Profile is a Phase 1 Must
   * Have on the employer portal, and its AC1 asks for the apprentice's
   * personal details, standard, provider, tutor and line manager — the record
   * of the employer's own employee.
   *
   * This replaces `assertPortalType(PROVIDER)`, which was a blanket refusal of
   * every employer rather than a decision about this enrolment. The predicate
   * is strictly stronger: being an employer portal was never sufficient, and
   * the question that matters is whether this caller is a party to *this*
   * enrolment.
   *
   * `providerOrganisationId` is deliberately NOT matched. It is a link
   * column, and the owning provider is already admitted by the first clause;
   * adding it would widen the route past the two parties without anything
   * asking for that.
   *
   * ── 404, NEVER 403 ──────────────────────────────────────────────────────────
   *
   * An id the caller may not read is answered as though it does not exist. A
   * 403 would confirm it does, which is a membership oracle: an employer could
   * enumerate ids and learn which belong to real enrolments at organisations
   * they have nothing to do with. The RLS policies agree — under
   * `graddly_app` the row is not visible at all, so the repository returns
   * null and this throws for the same reason on both layers.
   */
  private async findReadableEnrolment(
    callerOrganisationId: string,
    enrolmentId: string,
    relations: string[] = ['apprentice', 'standard', 'employerOrganisation'],
  ): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      // An array is an OR in TypeORM. Both arms pin `id`, so neither can
      // broaden to "any enrolment of mine".
      where: [
        {
          id: enrolmentId,
          organisationId: callerOrganisationId,
          isDeleted: false,
        },
        {
          id: enrolmentId,
          employerOrganisationId: callerOrganisationId,
          isDeleted: false,
        },
      ],
      relations,
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    return enrolment;
  }

  async getProfile(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<LearnerProfileResponseDto> {
    const enrolment = await this.findReadableEnrolment(
      user.organisationId!,
      enrolmentId,
    );

    /**
     * ── SCOPING, WHICH IS NOT THE SAME QUESTION AS AUTHORISATION ────────────
     *
     * Who may read this profile was settled above. What this is now is the
     * separate question of *whose rows* the profile is built from, and the
     * answer is always the enrolment's owning organisation — the provider —
     * whoever happens to be asking.
     *
     * That distinction is the whole defect. Every read below used to scope by
     * `user.organisationId`, which is right only while the caller is the
     * provider. For the employer named on the enrolment it silently returned
     * nothing: no documents, no reviews, no OTJ entries, no interventions. Not
     * a 403 the screen could report — an empty, plausible-looking profile.
     *
     * The caller's organisation is deliberately never bound in this scope. It
     * exists only inside findReadableEnrolment, so a read added to this method
     * later cannot reach for the wrong one. That is the point of resolving it
     * once here rather than fixing eight call sites.
     *
     * The employer's own organisation is still used where it belongs —
     * employerContacts below reads enrolment.employerOrganisationId, because
     * that genuinely is a question about the employer's records.
     */
    const organisationId = enrolment.organisationId;

    /**
     * F1.2.2 AC1 — "provider". The link column is null whenever the provider
     * owns the enrolment, which is the common case; the owner is then the
     * provider. enrolment-journey.service.ts and the roster resolve it the
     * same way.
     */
    const providerOrganisationId =
      enrolment.providerOrganisationId ?? enrolment.organisationId;

    const apprentice = enrolment.apprentice;
    const [
      documents,
      reviews,
      otjEntries,
      otjEntryCount,
      threads,
      otjPercent,
      tutorNames,
      providerNames,
      manager,
      recentInterventions,
      openBreak,
    ] = await Promise.all([
      this.documentsService.listForEnrolment(organisationId, enrolmentId),
      this.reviewRepo.find({
        where: { organisationId, enrolmentId, isDeleted: false },
        order: { scheduledAt: 'DESC' },
      }),
      /**
       * F2.2.4 AC3 — "all sessions submitted", not the most recent twenty.
       *
       * The cap is raised rather than removed. An apprenticeship logging
       * weekly for two years produces a few hundred entries, which the
       * profile can carry; an unbounded read would put the AC7 two-second
       * budget at the mercy of the worst-behaved account on the platform.
       * `otjEntryCount` tells the client when it is seeing a truncated list,
       * so the screen can say so rather than quietly showing less.
       */
      this.otjRepo.find({
        where: { organisationId, enrolmentId, isDeleted: false },
        order: { loggedDate: 'DESC' },
        take: LEARNER_PROFILE_OTJ_LIMIT,
      }),
      this.otjRepo.count({
        where: { organisationId, enrolmentId, isDeleted: false },
      }),
      // F2.2.4 AC5 — summaries, not bare ids. See the service method for why.
      this.messageThreadsService.listSummariesForEnrolment(user, enrolmentId),
      this.otjMetricsService.percentForEnrolment(enrolment),
      /**
       * F1.2.2 AC1 — the tutor's name, which came back null for an employer
       * beside a non-null userId.
       *
       * Routed through LearnerMetricsService rather than read here: the tutor
       * is a member of the *provider's* organisation, so `users_select` does
       * not admit the row for an employer caller. That service hydrates
       * display names under the RLS bootstrap flag, and the reasons it is
       * allowed to — plus the rules that come with it — are on
       * `loadTutorNames` and in `docs/employer-learner-access.md`.
       *
       * The line manager below is deliberately NOT routed the same way. They
       * are a member of the *employer's* organisation, so the employer — the
       * party AC1 is about — reads them under the ordinary policy, and a
       * provider caller falls back to `employerContacts`. Whether a provider
       * should see the named manager rather than that fallback is F2.2.4's
       * question, not this one's.
       */
      this.metricsService.loadTutorNames(
        enrolment.tutorUserId ? [enrolment.tutorUserId] : [],
      ),
      // The provider's name, under the same rule and for the same reason:
      // `organisations_select` admits members only, and the employer is not
      // a member of the provider.
      this.metricsService.loadOrganisationNames([providerOrganisationId]),
      enrolment.employerManagerUserId
        ? this.userRepo.findOne({
            where: { id: enrolment.employerManagerUserId },
          })
        : Promise.resolve(null),
      this.interventionActionsService.listRecentForEnrolment(
        organisationId,
        enrolmentId,
      ),
      // F2.2.4 AC6 — in the same parallel batch rather than sequenced after
      // it, so the profile's AC7 two-second budget is unaffected.
      this.breakInLearningService.findOpen(organisationId, enrolmentId),
    ]);

    const reviewItems = await Promise.all(
      reviews.map(async (review) => {
        const signatures = await this.signatureRepo.find({
          where: { organisationId, reviewId: review.id },
        });
        const tutorSigned = signatures.some(
          (s) =>
            s.party === ReviewSignerParty.TUTOR &&
            s.status === ReviewSignatureStatus.SIGNED,
        );
        const apprenticeSigned = signatures.some(
          (s) =>
            s.party === ReviewSignerParty.APPRENTICE &&
            s.status === ReviewSignatureStatus.SIGNED,
        );
        return {
          id: review.id,
          status: review.status,
          scheduledAt: review.scheduledAt.toISOString(),
          isOverdue: review.isOverdue,
          tutorSigned,
          apprenticeSigned,
        };
      }),
    );

    const employerContacts = enrolment.employerOrganisationId
      ? await this.metricsService.loadEmployerContacts([
          enrolment.employerOrganisationId,
        ])
      : new Map<
          string,
          { contactName: string | null; contactEmail: string | null }
        >();

    const employerContact = enrolment.employerOrganisationId
      ? employerContacts.get(enrolment.employerOrganisationId)
      : undefined;

    return {
      enrolmentId,
      personal: {
        firstName: apprentice.firstName,
        lastName: apprentice.lastName,
        email: apprentice.email,
      },
      employer: {
        organisationId: enrolment.employerOrganisationId,
        organisationName: enrolment.employerOrganisation?.name ?? null,
        managerName: manager
          ? `${manager.firstName} ${manager.lastName}`.trim()
          : (employerContact?.contactName ?? null),
        managerEmail: manager?.email ?? employerContact?.contactEmail ?? null,
      },
      provider: {
        organisationId: providerOrganisationId,
        name: providerNames.get(providerOrganisationId) ?? null,
      },
      programme: {
        standardTitle: enrolment.standard.title,
        plannedStartDate: enrolment.plannedStartDate,
        plannedEndDate: enrolment.plannedEndDate,
        epaDate: enrolment.epaDate,
        // F2.2.4 AC1 — who is assessing, not just when.
        epaOrganisationName: enrolment.epaOrganisationName,
        epaOrganisationUkprn: enrolment.epaOrganisationUkprn,
      },
      tutor: {
        userId: enrolment.tutorUserId,
        name: enrolment.tutorUserId
          ? (tutorNames.get(enrolment.tutorUserId) ?? null)
          : null,
      },
      reviews: reviewItems,
      otj: {
        otjPercent,
        totalCount: otjEntryCount,
        truncated: otjEntryCount > otjEntries.length,
        recentEntries: otjEntries.map((entry) => ({
          id: entry.id,
          loggedDate: entry.loggedDate,
          minutes: entry.minutes,
          status: entry.status,
          activityName: entry.activityName,
          // F2.2.4 AC3 — the tutor's flag travels with the entry, so the
          // profile can show which sessions are under discussion.
          flaggedAt: entry.flaggedAt ? entry.flaggedAt.toISOString() : null,
          flagNote: entry.flagNote,
        })),
      },
      documents,
      messageThreads: threads,
      breakInLearning: {
        /**
         * F2.2.4 AC6. `reason` and `expectedReturnDate` were hardcoded `null`
         * here because nothing stored them — the DTO promised two fields that
         * could never hold a value. They now come from the open break record.
         *
         * `active` still reads the apprentice status rather than the break
         * row: the status is what the rest of the platform acts on, so a
         * disagreement between the two should surface as "paused with no
         * break recorded" rather than be hidden by silently preferring one.
         */
        active: apprentice.status === ApprenticeStatus.PAUSED,
        reason: openBreak?.reason ?? null,
        expectedReturnDate: openBreak?.expectedReturnDate ?? null,
        recentInterventions,
      },
    };
  }

  /**
   * F1.2.2 AC3 — "OTJ hours chart showing weekly logged hours over the
   * programme lifetime".
   *
   * Grouped by the database, not the client. The profile's OTJ list is capped
   * at LEARNER_PROFILE_OTJ_LIMIT, so a long programme was silently truncated
   * there, and raising the cap would only hand the browser thousands of rows
   * to bucket. Same two parties as the profile, through the same
   * findReadableEnrolment; same scoping — the enrolment's owning
   * organisation, whoever asks. Under `graddly_app` the aggregate runs under
   * `otj_log_entries_select_linked_org` (1781100000018), which admits the
   * employer named on the enrolment.
   *
   * The chart's rules — ISO weeks, approved and pending kept apart (D2),
   * every week present — are the apprentice portal's, and live in
   * otj-weekly-buckets.ts so the two charts cannot disagree about a week.
   */
  async getOtjWeekly(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<LearnerOtjWeeklyResponseDto> {
    const enrolment = await this.findReadableEnrolment(
      user.organisationId!,
      enrolmentId,
      [],
    );

    // Monday of the ISO week, as text so no driver date parsing can shift it.
    const weekStart =
      "to_char(date_trunc('week', entry.\"loggedDate\"::timestamp), 'YYYY-MM-DD')";
    const rows = await this.otjRepo
      .createQueryBuilder('entry')
      .select(weekStart, 'weekStart')
      .addSelect('entry.status', 'status')
      .addSelect('SUM(entry.minutes)', 'minutes')
      .where('entry."enrolmentId" = :enrolmentId', { enrolmentId })
      .andWhere('entry."organisationId" = :organisationId', {
        organisationId: enrolment.organisationId,
      })
      .andWhere('entry."isDeleted" = false')
      // Approved is authoritative; submitted is the pending figure. Draft and
      // rejected entries are never counted, so they are never read.
      .andWhere('entry.status IN (:...statuses)', {
        statuses: [OtjLogStatus.APPROVED, OtjLogStatus.SUBMITTED],
      })
      .groupBy(weekStart)
      .addGroupBy('entry.status')
      .getRawMany<IOtjWeeklyRow>();

    const { weeks, truncated } = buildWeeklyBuckets(rows, {
      programmeStart: enrolment.plannedStartDate,
      today: new Date(),
    });

    return {
      enrolmentId,
      programmeStart: enrolment.plannedStartDate,
      weeks,
      truncated,
    };
  }
}
