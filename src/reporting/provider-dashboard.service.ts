import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { IlrLearnerRecordStatus } from '../ilr/enums/ilr-learner-record-status.enum.js';
import { LearnerMetricsService } from '../learners/learner-metrics.service.js';
import { percentToEifRag } from '../ofsted/eif-rag.util.js';
import { EifScoreCalculatorService } from '../ofsted/eif-score-calculator.service.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { ReportingPortalService } from './reporting-portal.service.js';

import type { ProviderDashboardResponseDto } from './dto/provider-dashboard-response.dto.js';

@Injectable()
export class ProviderDashboardService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly learnerMetrics: LearnerMetricsService,
    private readonly eifCalculator: EifScoreCalculatorService,
    @InjectRepository(IlrLearnerRecord)
    private readonly ilrRecordRepo: Repository<IlrLearnerRecord>,
  ) {}

  async getDashboard(
    organisationId: string,
  ): Promise<ProviderDashboardResponseDto> {
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const [enrolments, eifScores, ilrPendingCount] = await Promise.all([
      this.learnerMetrics.loadActiveEnrolments(organisationId),
      this.eifCalculator.calculate(organisationId),
      this.ilrRecordRepo.count({
        where: {
          organisationId,
          status: IlrLearnerRecordStatus.DRAFT,
          isDeleted: false,
        },
      }),
    ]);

    const contexts = await Promise.all(
      enrolments.map((enrolment) =>
        this.learnerMetrics.buildContext(enrolment, organisationId),
      ),
    );
    const atRiskCount = contexts.filter((ctx) => ctx.severityScore > 0).length;

    return {
      summary: {
        cohortCount: enrolments.length,
        atRiskCount,
        eifOverallPercent: eifScores.overallPercent,
        eifOverallRag: percentToEifRag(eifScores.overallPercent),
        ilrPendingCount,
      },
    };
  }
}
