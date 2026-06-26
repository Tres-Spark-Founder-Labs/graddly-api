import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type { EmployerDashboardResponseDto } from './dto/employer-dashboard-response.dto.js';

@Injectable()
export class EmployerDashboardService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly pipelineService: CommitmentPipelineService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(OtjLogEntry)
    private readonly otjLogRepo: Repository<OtjLogEntry>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
  ) {}

  async getDashboard(
    employerOrganisationId: string,
  ): Promise<EmployerDashboardResponseDto> {
    await this.portalService.assertPortalType(
      employerOrganisationId,
      PortalType.EMPLOYER,
    );

    const activeEnrolments = await this.enrolmentRepo.find({
      where: {
        employerOrganisationId,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
      select: ['id', 'organisationId'],
    });

    const enrolmentIds = activeEnrolments.map((e) => e.id);
    const providerOrgIds = [
      ...new Set(activeEnrolments.map((e) => e.organisationId)),
    ];

    const [pendingOtjCount, reviewsAwaitingCount, pipelineCounts] =
      await Promise.all([
        this.countPendingOtjApprovals(enrolmentIds),
        this.countReviewsAwaitingAction(enrolmentIds, providerOrgIds),
        this.pipelineService.countByPipelineStatusForEmployer(
          employerOrganisationId,
        ),
      ]);

    return {
      summary: {
        activeApprenticeCount: enrolmentIds.length,
        pendingOtjApprovalCount: pendingOtjCount,
        reviewsAwaitingActionCount: reviewsAwaitingCount,
        commitmentPipeline: this.mapPipelineCounts(pipelineCounts),
      },
    };
  }

  private async countPendingOtjApprovals(
    enrolmentIds: string[],
  ): Promise<number> {
    if (enrolmentIds.length === 0) {
      return 0;
    }

    return this.otjLogRepo.count({
      where: {
        enrolmentId: In(enrolmentIds),
        status: OtjLogStatus.SUBMITTED,
        isDeleted: false,
      },
    });
  }

  private async countReviewsAwaitingAction(
    enrolmentIds: string[],
    providerOrgIds: string[],
  ): Promise<number> {
    if (enrolmentIds.length === 0 || providerOrgIds.length === 0) {
      return 0;
    }

    return this.reviewRepo.count({
      where: {
        enrolmentId: In(enrolmentIds),
        organisationId: In(providerOrgIds),
        status: ReviewStatus.AWAITING_SIGNATURES,
        isDeleted: false,
      },
    });
  }

  private mapPipelineCounts(
    counts: Record<CommitmentPipelineStatus, number>,
  ): EmployerDashboardResponseDto['summary']['commitmentPipeline'] {
    return {
      none: counts[CommitmentPipelineStatus.NONE],
      draft: counts[CommitmentPipelineStatus.DRAFT],
      awaitingSignatures: counts[CommitmentPipelineStatus.AWAITING_SIGNATURES],
      signed: counts[CommitmentPipelineStatus.SIGNED],
      cancelled: counts[CommitmentPipelineStatus.CANCELLED],
    };
  }
}
