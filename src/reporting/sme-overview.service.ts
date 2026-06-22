import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { LearnerMetricsService } from '../learners/learner-metrics.service.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type { SmeOverviewResponseDto } from './dto/sme-overview-response.dto.js';

const PENDING_OTJ_CAP = 20;

@Injectable()
export class SmeOverviewService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly learnerMetrics: LearnerMetricsService,
    private readonly otjMetrics: OtjProgressMetricsService,
    private readonly pipelineService: CommitmentPipelineService,
    @InjectRepository(OtjLogEntry)
    private readonly otjLogRepo: Repository<OtjLogEntry>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
  ) {}

  async getOverview(organisationId: string): Promise<SmeOverviewResponseDto> {
    await this.portalService.assertPortalType(organisationId, PortalType.FLOW);

    const enrolments =
      await this.learnerMetrics.loadActiveEnrolments(organisationId);
    const enrolmentIds = enrolments.map((e) => e.id);

    const [pendingOtj, reviewsDueCount, pipelineCounts, contexts] =
      await Promise.all([
        this.loadPendingOtjApprovals(organisationId),
        this.countReviewsDueThisMonth(organisationId),
        this.pipelineService.countByPipelineStatus(organisationId),
        Promise.all(
          enrolments.map((enrolment) =>
            this.learnerMetrics.buildContext(enrolment, organisationId),
          ),
        ),
      ]);

    const apprentices = await Promise.all(
      contexts.map(async (ctx) => {
        const otjPercent = await this.otjMetrics.percentForEnrolment(
          organisationId,
          ctx.enrolment,
        );
        const apprentice = ctx.enrolment.apprentice;
        const standard = ctx.enrolment.standard;
        return {
          enrolmentId: ctx.enrolment.id,
          learnerName: `${apprentice.firstName} ${apprentice.lastName}`,
          programmeTitle: standard.title,
          otjPercent,
          nextReviewDate:
            ctx.nextReviewDate?.toISOString().slice(0, 10) ?? null,
          statusBadge: ctx.statusBadge,
        };
      }),
    );

    return {
      summary: {
        activeApprenticeCount: enrolmentIds.length,
        pendingOtjApprovalCount: pendingOtj.total,
        reviewsDueThisMonthCount: reviewsDueCount,
        commitmentPipeline: this.mapPipelineCounts(pipelineCounts),
      },
      pendingOtjApprovals: pendingOtj.items,
      apprentices,
    };
  }

  private async loadPendingOtjApprovals(organisationId: string): Promise<{
    total: number;
    items: SmeOverviewResponseDto['pendingOtjApprovals'];
  }> {
    const [items, total] = await this.otjLogRepo.findAndCount({
      where: {
        organisationId,
        status: OtjLogStatus.SUBMITTED,
        isDeleted: false,
      },
      relations: ['enrolment', 'enrolment.apprentice'],
      order: { loggedDate: 'DESC' },
      take: PENDING_OTJ_CAP,
    });

    return {
      total,
      items: items.map((entry) => ({
        id: entry.id,
        apprenticeName: `${entry.enrolment.apprentice.firstName} ${entry.enrolment.apprentice.lastName}`,
        loggedDate:
          typeof entry.loggedDate === 'string'
            ? entry.loggedDate.slice(0, 10)
            : String(entry.loggedDate),
        minutes: entry.minutes,
        enrolmentId: entry.enrolmentId,
      })),
    };
  }

  private async countReviewsDueThisMonth(
    organisationId: string,
  ): Promise<number> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
    );

    return this.reviewRepo.count({
      where: {
        organisationId,
        status: ReviewStatus.SCHEDULED,
        scheduledAt: Between(monthStart, monthEnd),
        isDeleted: false,
      },
    });
  }

  private mapPipelineCounts(
    counts: Record<CommitmentPipelineStatus, number>,
  ): SmeOverviewResponseDto['summary']['commitmentPipeline'] {
    return {
      none: counts[CommitmentPipelineStatus.NONE],
      draft: counts[CommitmentPipelineStatus.DRAFT],
      awaitingSignatures: counts[CommitmentPipelineStatus.AWAITING_SIGNATURES],
      signed: counts[CommitmentPipelineStatus.SIGNED],
      cancelled: counts[CommitmentPipelineStatus.CANCELLED],
    };
  }
}
