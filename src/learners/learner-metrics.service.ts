import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

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
      apprenticeStatus: enrolment.apprentice.status,
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

  async loadTutorNames(tutorUserIds: string[]): Promise<Map<string, string>> {
    if (tutorUserIds.length === 0) {
      return new Map();
    }
    const users = await this.userRepo.findBy({ id: In(tutorUserIds) });
    return new Map(
      users.map((user) => [
        user.id,
        `${user.firstName} ${user.lastName}`.trim(),
      ]),
    );
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
