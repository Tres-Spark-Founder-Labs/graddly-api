import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EnrolmentJourneyService } from '../enrolments/enrolment-journey.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import type { LearnerMeSummaryResponseDto } from './dto/learner-me-summary-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class LearnerMeSummaryService {
  constructor(
    private readonly portalService: ReportingPortalService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    private readonly journeyService: EnrolmentJourneyService,
    private readonly otjMetrics: OtjProgressMetricsService,
  ) {}

  async getSummary(
    user: AuthenticatedUser,
  ): Promise<LearnerMeSummaryResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const enrolment = await this.enrolmentRepo.findOne({
      where: {
        organisationId,
        apprenticeUserId: user.id,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
      relations: ['standard'],
      order: { createdAt: 'DESC' },
    });

    if (!enrolment) {
      return {
        activeEnrolmentId: null,
        activeApprenticeId: null,
        programmeTitle: null,
        enrolmentStatus: null,
        otjPace: {
          alertLevel: null,
          otjPercent: null,
          approvedMinutes: 0,
        },
        nextReviewDate: null,
        daysToEpa: null,
        epaDate: null,
      };
    }

    const [journey, otjPercent, nextReviewDate] = await Promise.all([
      this.journeyService.getJourney(user, enrolment.id),
      this.otjMetrics.percentForEnrolment(organisationId, enrolment),
      this.loadNextReviewDate(enrolment.id, organisationId),
    ]);

    return {
      activeEnrolmentId: enrolment.id,
      activeApprenticeId: enrolment.apprenticeId,
      programmeTitle: enrolment.standard.title,
      enrolmentStatus: enrolment.status,
      otjPace: {
        alertLevel: journey.pace.alertLevel,
        otjPercent,
        approvedMinutes: journey.pace.approvedMinutes,
      },
      nextReviewDate,
      daysToEpa: journey.daysToEpa,
      epaDate: journey.epaDate,
    };
  }

  private async loadNextReviewDate(
    enrolmentId: string,
    organisationId: string,
  ): Promise<string | null> {
    const now = new Date();
    const review = await this.reviewRepo.findOne({
      where: {
        enrolmentId,
        organisationId,
        status: ReviewStatus.SCHEDULED,
        isDeleted: false,
      },
      order: { scheduledAt: 'ASC' },
    });

    if (!review || review.scheduledAt <= now) {
      return null;
    }

    return review.scheduledAt.toISOString().slice(0, 10);
  }
}
