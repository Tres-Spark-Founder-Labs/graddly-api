import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
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
    @InjectRepository(MessageThread)
    private readonly threadRepo: Repository<MessageThread>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly portalService: ReportingPortalService,
    private readonly documentsService: LearnerDocumentsService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    private readonly metricsService: LearnerMetricsService,
    private readonly interventionActionsService: InterventionActionsService,
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
      threads,
      otjPercent,
      tutor,
      manager,
      recentInterventions,
    ] = await Promise.all([
      this.documentsService.listForEnrolment(organisationId, enrolmentId),
      this.reviewRepo.find({
        where: { organisationId, enrolmentId, isDeleted: false },
        order: { scheduledAt: 'DESC' },
      }),
      this.otjRepo.find({
        where: { organisationId, enrolmentId, isDeleted: false },
        order: { loggedDate: 'DESC' },
        take: 20,
      }),
      this.threadRepo.find({
        where: { organisationId, enrolmentId, isDeleted: false },
        select: ['id'],
      }),
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
      },
      tutor: {
        userId: enrolment.tutorUserId,
        name: tutor ? `${tutor.firstName} ${tutor.lastName}`.trim() : null,
      },
      reviews: reviewItems,
      otj: {
        otjPercent,
        recentEntries: otjEntries.map((entry) => ({
          id: entry.id,
          loggedDate: entry.loggedDate,
          minutes: entry.minutes,
          status: entry.status,
        })),
      },
      documents,
      messageThreadIds: threads.map((thread) => thread.id),
      breakInLearning: {
        active: apprentice.status === ApprenticeStatus.PAUSED,
        reason: null,
        expectedReturnDate: null,
        recentInterventions,
      },
    };
  }
}
