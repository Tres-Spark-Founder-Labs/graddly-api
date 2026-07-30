import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { DasFundingSyncService } from '../das/das-funding-sync.service.js';
import { DasLevyForecastService } from '../das/das-levy-forecast.service.js';
import { DasLevyMonthlyService } from '../das/das-levy-monthly.service.js';
import { DasLevySyncService } from '../das/das-levy-sync.service.js';
import { DasLevyBalance } from '../das/entities/das-levy-balance.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../levy-exchange/enums/levy-transfer-status.enum.js';
import { LevySurplusService } from '../levy-exchange/services/levy-surplus.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { LevyRoiBreakdownGroup } from './enums/levy-roi-breakdown-group.enum.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type {
  LevyRoiBreakdownEntryResponseDto,
  LevyRoiReportResponseDto,
} from './dto/levy-roi-report-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { ILevyRoiReportContent } from '../pdf/interfaces/pdf-renderer.interface.js';

/** v1 productivity uplift estimate per completed apprenticeship (GBP). */
const PRODUCTIVITY_UPLIFT_FACTOR = 5000;

@Injectable()
export class LevyRoiReportService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly dasSyncService: DasLevySyncService,
    private readonly monthlyService: DasLevyMonthlyService,
    private readonly fundingSyncService: DasFundingSyncService,
    private readonly forecastService: DasLevyForecastService,
    private readonly surplusService: LevySurplusService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    private readonly pdfDispatch: PdfDispatchService,
    @InjectRepository(DasLevyBalance)
    private readonly levyBalanceRepo: Repository<DasLevyBalance>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
  ) {}

  async getSummary(organisationId: string): Promise<LevyRoiReportResponseDto> {
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.EMPLOYER,
    );

    const [
      balance,
      forecast,
      surplusSummary,
      enrolments,
      transferTotal,
      monthlyEntries,
      fundingSummary,
    ] = await Promise.all([
      this.dasSyncService.getLatestForOrganisation(organisationId),
      this.forecastService.forecastForOrganisation(organisationId),
      this.surplusService.getSurplus(organisationId),
      this.enrolmentRepo.find({
        where: { organisationId, isDeleted: false },
      }),
      this.sumConfirmedTransfers(organisationId),
      this.monthlyService.listLast12Months(organisationId),
      this.fundingSyncService.getFundingSummary(organisationId),
    ]);

    const activeEnrolments = enrolments.filter(
      (e) => e.status === EnrolmentStatus.ACTIVE,
    );
    const completedEnrolments = enrolments.filter(
      (e) => e.status === EnrolmentStatus.COMPLETED,
    );

    const availableBalance =
      balance.balance !== null ? Number(balance.balance) : null;
    const totalLevySpendToDate = (availableBalance ?? 0) + transferTotal;

    const utilisationPercent = this.computeUtilisation(
      availableBalance,
      forecast.projectedMonthlySpend,
    );

    return {
      organisationId,
      totalLevySpendToDate: Number(totalLevySpendToDate.toFixed(2)),
      availableBalance,
      currency: balance.currency,
      utilisationPercent,
      forecast: {
        horizonMonths: forecast.horizonMonths,
        activeEnrolmentCount: forecast.activeEnrolmentCount,
        projectedMonthlySpend: forecast.projectedMonthlySpend,
        projectedCompletionLiability: forecast.projectedCompletionLiability,
        estimatedRunwayMonths: forecast.estimatedRunwayMonths,
      },
      surplusSummary,
      activeApprenticeCount: activeEnrolments.length,
      completionCount: completedEnrolments.length,
      averageCostPerCompletion: this.averageAgreedPrice(completedEnrolments),
      epaPassRate: null,
      estimatedProductivityUplift:
        completedEnrolments.length * PRODUCTIVITY_UPLIFT_FACTOR,
      monthlyContributions: this.monthlyService
        .toMonthlyContributionDtos(monthlyEntries)
        .map((row) => ({ month: row.month, amount: row.amount })),
      fundingSummary,
      generatedAt: new Date().toISOString(),
    };
  }

  async getBreakdown(
    organisationId: string,
    groupBy: LevyRoiBreakdownGroup,
  ): Promise<LevyRoiBreakdownEntryResponseDto[]> {
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.EMPLOYER,
    );

    const enrolments = await this.enrolmentRepo.find({
      where: { organisationId, isDeleted: false },
      relations: ['apprentice'],
    });

    if (groupBy === LevyRoiBreakdownGroup.PROVIDER) {
      return this.breakdownByProvider(organisationId, enrolments);
    }

    return this.breakdownByStandard(organisationId, enrolments);
  }

  async exportPdf(user: AuthenticatedUser): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.EMPLOYER,
    );

    const job = await this.pdfDispatch.enqueue({
      organisationId,
      userId: user.id,
      template: PdfJobTemplate.LEVY_ROI_REPORT,
    });

    return {
      jobId: job.id,
      status: job.status,
      template: job.template,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  async buildPdfContent(
    organisationId: string,
  ): Promise<ILevyRoiReportContent> {
    const [
      organisation,
      summary,
      providerBreakdown,
      standardBreakdown,
      balance,
      forecast,
    ] = await Promise.all([
      this.loadOrganisationWithBootstrap(organisationId),
      this.getSummary(organisationId),
      this.getBreakdown(organisationId, LevyRoiBreakdownGroup.PROVIDER),
      this.getBreakdown(organisationId, LevyRoiBreakdownGroup.STANDARD),
      this.levyBalanceRepo.findOne({
        where: { organisationId, isDeleted: false },
      }),
      // F1.1.5 AC1: the exported report must include the forecast. It was
      // already computed for the API response but never reached the PDF.
      this.forecastService.forecastForOrganisation(organisationId),
    ]);

    return {
      organisationName: organisation.name,
      logoUrl: organisation.logoUrl,
      summary: {
        totalLevySpendToDate: summary.totalLevySpendToDate,
        availableBalance: summary.availableBalance,
        currency: summary.currency,
        utilisationPercent: summary.utilisationPercent,
        activeApprenticeCount: summary.activeApprenticeCount,
        completionCount: summary.completionCount,
        averageCostPerCompletion: summary.averageCostPerCompletion,
        epaPassRate: summary.epaPassRate,
        estimatedProductivityUplift: summary.estimatedProductivityUplift,
        monthlyContributions: summary.monthlyContributions,
        utilisationSegments: balance?.utilisationSegments ?? null,
      },
      forecast: {
        horizonMonths: forecast.horizonMonths,
        activeEnrolmentCount: forecast.activeEnrolmentCount,
        projectedMonthlySpend: forecast.projectedMonthlySpend,
        projectedCompletionLiability: forecast.projectedCompletionLiability,
        estimatedRunwayMonths: forecast.estimatedRunwayMonths,
      },
      breakdownByProvider: providerBreakdown,
      breakdownByStandard: standardBreakdown,
      generatedAt: new Date().toISOString(),
    };
  }

  private async breakdownByProvider(
    organisationId: string,
    enrolments: Enrolment[],
  ): Promise<LevyRoiBreakdownEntryResponseDto[]> {
    const grouped = this.groupEnrolments(
      enrolments,
      (e) => e.providerOrganisationId,
    );
    const providerIds = [...grouped.keys()].filter(
      (id): id is string => id !== null,
    );
    const labels = await this.loadOrganisationNames(providerIds);

    const entries: LevyRoiBreakdownEntryResponseDto[] = [];
    for (const [groupId, groupEnrolments] of grouped) {
      if (!groupId) {
        continue;
      }
      entries.push(
        await this.buildBreakdownEntry(
          organisationId,
          groupId,
          labels.get(groupId) ?? 'Unknown provider',
          groupEnrolments,
        ),
      );
    }

    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async breakdownByStandard(
    organisationId: string,
    enrolments: Enrolment[],
  ): Promise<LevyRoiBreakdownEntryResponseDto[]> {
    const grouped = this.groupEnrolments(enrolments, (e) => e.standardId);
    const standardIds = [...grouped.keys()].filter(
      (id): id is string => id !== null,
    );
    const standards = standardIds.length
      ? await this.standardRepo.findBy({
          id: In(standardIds),
          isDeleted: false,
        })
      : [];
    const standardMap = new Map(standards.map((s) => [s.id, s]));

    const entries: LevyRoiBreakdownEntryResponseDto[] = [];
    for (const [groupId, groupEnrolments] of grouped) {
      if (!groupId) {
        continue;
      }
      const standard = standardMap.get(groupId);
      const entry = await this.buildBreakdownEntry(
        organisationId,
        groupId,
        standard?.title ?? 'Unknown standard',
        groupEnrolments,
      );
      if (standard?.code) {
        entry.code = standard.code;
      }
      entries.push(entry);
    }

    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  private async buildBreakdownEntry(
    organisationId: string,
    groupId: string,
    label: string,
    enrolments: Enrolment[],
  ): Promise<LevyRoiBreakdownEntryResponseDto> {
    const active = enrolments.filter(
      (e) => e.status === EnrolmentStatus.ACTIVE,
    );
    const completed = enrolments.filter(
      (e) => e.status === EnrolmentStatus.COMPLETED,
    );
    const inFlightIds = [...active, ...completed].map((e) => e.id);

    const [averageOtjPercent, reviewComplianceRate] = await Promise.all([
      this.otjMetricsService.averageOtjPercentForEnrolments(
        organisationId,
        inFlightIds,
      ),
      this.reviewComplianceRateForEnrolments(organisationId, inFlightIds),
    ]);

    return {
      groupId,
      label,
      activeApprenticeCount: active.length,
      completionCount: completed.length,
      averageCostPerCompletion: this.averageAgreedPrice(completed),
      averageOtjPercent,
      reviewComplianceRate,
      withdrawalRate: this.withdrawalRate(enrolments),
    };
  }

  /** % of reviews scheduled up to now that reached `completed` status. */
  private async reviewComplianceRateForEnrolments(
    organisationId: string,
    enrolmentIds: string[],
  ): Promise<number | null> {
    if (enrolmentIds.length === 0) {
      return null;
    }

    const dueReviews = await this.reviewRepo.find({
      where: {
        organisationId,
        enrolmentId: In(enrolmentIds),
        isDeleted: false,
      },
      select: ['status', 'scheduledAt'],
    });

    const now = new Date();
    const due = dueReviews.filter((r) => r.scheduledAt <= now);
    if (due.length === 0) {
      return null;
    }
    const compliant = due.filter(
      (r) => r.status === ReviewStatus.COMPLETED,
    ).length;
    return Number(((compliant / due.length) * 100).toFixed(2));
  }

  /** % of the group's enrolments (any status) withdrawn or cancelled. */
  private withdrawalRate(enrolments: Enrolment[]): number | null {
    if (enrolments.length === 0) {
      return null;
    }
    const withdrawn = enrolments.filter(
      (e) =>
        e.status === EnrolmentStatus.CANCELLED ||
        e.apprentice?.status === ApprenticeStatus.WITHDRAWN,
    ).length;
    return Number(((withdrawn / enrolments.length) * 100).toFixed(2));
  }

  private groupEnrolments(
    enrolments: Enrolment[],
    keyFn: (enrolment: Enrolment) => string | null,
  ): Map<string | null, Enrolment[]> {
    const map = new Map<string | null, Enrolment[]>();
    for (const enrolment of enrolments) {
      const key = keyFn(enrolment);
      const bucket = map.get(key) ?? [];
      bucket.push(enrolment);
      map.set(key, bucket);
    }
    return map;
  }

  private averageAgreedPrice(enrolments: Enrolment[]): number | null {
    const prices = enrolments
      .map((e) => (e.agreedPrice !== null ? Number(e.agreedPrice) : null))
      .filter(
        (value): value is number => value !== null && !Number.isNaN(value),
      );
    if (prices.length === 0) {
      return null;
    }
    const total = prices.reduce((sum, value) => sum + value, 0);
    return Number((total / prices.length).toFixed(2));
  }

  private computeUtilisation(
    balance: number | null,
    projectedMonthlySpend: number,
  ): number | null {
    const annualSpend = projectedMonthlySpend * 12;
    const denominator = (balance ?? 0) + annualSpend;
    if (denominator <= 0) {
      return null;
    }
    return Number(((annualSpend / denominator) * 100).toFixed(2));
  }

  private async sumConfirmedTransfers(organisationId: string): Promise<number> {
    const transfers = await this.transferRepo.find({
      where: {
        donorOrganisationId: organisationId,
        status: In([LevyTransferStatus.CONFIRMED, LevyTransferStatus.ACTIVE]),
        isDeleted: false,
      },
      select: ['amount'],
    });
    return transfers.reduce((sum, t) => sum + Number(t.amount), 0);
  }

  private async loadOrganisationNames(
    organisationIds: string[],
  ): Promise<Map<string, string>> {
    if (organisationIds.length === 0) {
      return new Map();
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisations = await this.organisationRepo.findBy({
        id: In(organisationIds),
        isDeleted: false,
      });
      return new Map(organisations.map((org) => [org.id, org.name]));
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadOrganisationWithBootstrap(
    organisationId: string,
  ): Promise<Organisation> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisation = await this.organisationRepo.findOne({
        where: { id: organisationId, isDeleted: false },
      });
      if (!organisation) {
        throw new Error('Organisation not found for PDF');
      }
      return organisation;
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }
}
