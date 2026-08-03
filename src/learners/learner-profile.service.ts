import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import { BreakInLearningService } from '../enrolments/break-in-learning.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewSignatureStatus } from '../reviews/enums/review-signature-status.enum.js';
import { ReviewSignerParty } from '../reviews/enums/review-signer-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import { LearnerProfileResponseDto } from './dto/learner-profile-response.dto.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';

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
    private readonly portalService: ReportingPortalService,
    private readonly documentsService: LearnerDocumentsService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    private readonly metricsService: LearnerMetricsService,
    private readonly interventionActionsService: InterventionActionsService,
    private readonly breakInLearningService: BreakInLearningService,
    private readonly messageThreadsService: MessageThreadsService,
  ) {}

  async getProfile(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<LearnerProfileResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
      relations: ['apprentice', 'standard', 'employerOrganisation'],
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }

    const apprentice = enrolment.apprentice;
    const [
      documents,
      reviews,
      otjEntries,
      otjEntryCount,
      threads,
      otjPercent,
      tutor,
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
      enrolment.tutorUserId
        ? this.userRepo.findOne({ where: { id: enrolment.tutorUserId } })
        : Promise.resolve(null),
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
        name: tutor ? `${tutor.firstName} ${tutor.lastName}`.trim() : null,
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
}
