import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { cohortEntriesToCsv } from './cohort-csv.util.js';
import { LearnerCohortEntryResponseDto } from './dto/learner-provider-response.dto.js';
import { ListLearnerCohortQueryDto } from './dto/list-learner-cohort-query.dto.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import {
  LEARNER_STATUS_BADGE_LABELS,
  LearnerStatusBadge,
} from './utils/learner-status-badge.util.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';
import type { ILearnerCohortContent } from '../pdf/interfaces/pdf-renderer.interface.js';

export type LearnerCohortCsvResult = {
  csv: string;
  meta: IPaginationMeta;
};

export type LearnerCohortResult =
  | PaginatedResult<LearnerCohortEntryResponseDto>
  | LearnerCohortCsvResult;

@Injectable()
export class LearnerCohortService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly metricsService: LearnerMetricsService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    // F2.2.1 AC5 — the PDF export names the provider and goes through the
    // shared job pipeline, like every other PDF on the platform.
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    private readonly pdfDispatch: PdfDispatchService,
  ) {}

  /** F2.2.1 AC5 — queue the cohort table as a PDF. */
  async exportPdf(
    user: AuthenticatedUser,
    query: ListLearnerCohortQueryDto,
  ): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const job = await this.pdfDispatch.enqueue({
      organisationId,
      userId: user.id,
      template: PdfJobTemplate.LEARNER_COHORT,
      // The filters travel with the job so the worker rebuilds exactly the
      // table the provider was looking at, not the whole cohort.
      cohortQuery: { ...query },
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

  async list(
    user: AuthenticatedUser,
    query: ListLearnerCohortQueryDto,
  ): Promise<LearnerCohortResult> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const rows = await this.buildRows(organisationId, query);

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const total = rows.length;
    const meta = buildPaginationMeta({ page, perPage, total });

    if (query.format === 'csv') {
      // Deliberately every matching row, not just the current page: an export
      // that silently gives you twenty of four hundred learners is worse than
      // no export.
      return { csv: cohortEntriesToCsv(rows), meta };
    }

    const start = (page - 1) * perPage;
    return new PaginatedResult(rows.slice(start, start + perPage), meta);
  }

  /**
   * Filtered and sorted rows for the whole organisation, before paging.
   *
   * Shared by the table, the CSV and the PDF so the three cannot drift: an
   * export that applies filters differently from the screen it was taken from
   * is the kind of discrepancy nobody notices until an audit.
   */
  private async buildRows(
    organisationId: string,
    query: ListLearnerCohortQueryDto,
  ): Promise<LearnerCohortEntryResponseDto[]> {
    const enrolments =
      await this.metricsService.loadActiveEnrolments(organisationId);

    const contexts = await Promise.all(
      enrolments.map((enrolment) =>
        this.metricsService.buildContext(enrolment, organisationId),
      ),
    );

    const otjPercents = await Promise.all(
      contexts.map(async (ctx) => ({
        enrolmentId: ctx.enrolment.id,
        percent: await this.otjMetricsService.percentForEnrolment(
          ctx.enrolment,
        ),
      })),
    );
    const otjMap = new Map(
      otjPercents.map((row) => [row.enrolmentId, row.percent]),
    );

    const tutorIds = [
      ...new Set(
        contexts
          .map((ctx) => ctx.enrolment.tutorUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const tutorNames = await this.metricsService.loadTutorNames(tutorIds);

    let rows: LearnerCohortEntryResponseDto[] = contexts.map((ctx) => {
      const enrolment = ctx.enrolment;
      const apprentice = enrolment.apprentice;
      return {
        enrolmentId: enrolment.id,
        learnerName: `${apprentice.firstName} ${apprentice.lastName}`.trim(),
        employerName: enrolment.employerOrganisation?.name ?? null,
        standardTitle: enrolment.standard.title,
        startDate: enrolment.plannedStartDate,
        otjPercent: otjMap.get(enrolment.id) ?? null,
        nextReviewDate: ctx.nextReviewDate?.toISOString() ?? null,
        epaDate: enrolment.epaDate,
        statusBadge: ctx.statusBadge,
        tutorName: enrolment.tutorUserId
          ? (tutorNames.get(enrolment.tutorUserId) ?? null)
          : null,
      };
    });

    rows = this.applyFilters(rows, contexts, query);
    rows = this.applySort(rows, query);
    return rows;
  }

  /**
   * F2.2.1 AC5 — content for the PDF export.
   *
   * Runs the same `buildRows` the table does, so the document says what the
   * screen said. The filter summary is built here rather than passed from the
   * client: a caller that describes its own filters can describe them wrongly,
   * and this document exists to be handed to someone who was not there when
   * they were applied.
   */
  async buildPdfContent(
    organisationId: string,
    query: ListLearnerCohortQueryDto,
  ): Promise<ILearnerCohortContent> {
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const rows = await this.buildRows(organisationId, query);
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId },
      select: ['name'],
    });
    const organisationName = organisation?.name ?? 'Unknown organisation';

    const counts = new Map<LearnerStatusBadge, number>();
    for (const row of rows) {
      counts.set(row.statusBadge, (counts.get(row.statusBadge) ?? 0) + 1);
    }

    return {
      organisationName,
      filterSummary: this.describeFilters(query),
      totalCount: rows.length,
      statusCounts: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([badge, count]) => ({
          label: LEARNER_STATUS_BADGE_LABELS[badge],
          count,
        })),
      rows: rows.map((row) => ({
        learnerName: row.learnerName,
        employerName: row.employerName,
        standardTitle: row.standardTitle,
        startDate: row.startDate,
        otjPercent: row.otjPercent,
        // Stored as an ISO timestamp; the reader wants a date.
        nextReviewDate: row.nextReviewDate
          ? row.nextReviewDate.slice(0, 10)
          : null,
        epaDate: row.epaDate,
        statusLabel: LEARNER_STATUS_BADGE_LABELS[row.statusBadge],
        tutorName: row.tutorName,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * F2.2.1 AC2 — the option lists for the employer, standard and tutor
   * filters.
   *
   * Derived from the provider's own cohort rather than from the full
   * employer/standard/user tables. A dropdown offering four hundred employers
   * when twelve of them have learners is a worse control than no control:
   * every value here matches at least one row.
   */
  async getFilterOptions(user: AuthenticatedUser): Promise<{
    employers: Array<{ id: string; name: string }>;
    standards: Array<{ id: string; name: string }>;
    tutors: Array<{ id: string; name: string }>;
  }> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const enrolments =
      await this.metricsService.loadActiveEnrolments(organisationId);

    const tutorIds = [
      ...new Set(
        enrolments
          .map((e) => e.tutorUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const tutorNames = await this.metricsService.loadTutorNames(tutorIds);

    const employers = new Map<string, string>();
    const standards = new Map<string, string>();
    for (const enrolment of enrolments) {
      if (enrolment.employerOrganisationId && enrolment.employerOrganisation) {
        employers.set(
          enrolment.employerOrganisationId,
          enrolment.employerOrganisation.name,
        );
      }
      if (enrolment.standard) {
        standards.set(enrolment.standard.id, enrolment.standard.title);
      }
    }

    const toSortedList = (map: Map<string, string>) =>
      [...map.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
      employers: toSortedList(employers),
      standards: toSortedList(standards),
      tutors: toSortedList(
        new Map(
          tutorIds.map((id) => [id, tutorNames.get(id) ?? 'Unnamed tutor']),
        ),
      ),
    };
  }

  /** Plain-English description of the applied filters, for the PDF header. */
  private describeFilters(query: ListLearnerCohortQueryDto): string | null {
    const parts: string[] = [];
    if (query.employerOrganisationId) parts.push('one employer');
    if (query.standardId) parts.push('one standard');
    if (query.statusBadge) {
      parts.push(`status ${LEARNER_STATUS_BADGE_LABELS[query.statusBadge]}`);
    }
    if (query.tutorUserId) parts.push('one tutor');
    if (query.epaMonth) parts.push(`EPA in ${query.epaMonth}`);
    return parts.length ? parts.join(', ') : null;
  }

  private applyFilters(
    rows: LearnerCohortEntryResponseDto[],
    contexts: Awaited<ReturnType<LearnerMetricsService['buildContext']>>[],
    query: ListLearnerCohortQueryDto,
  ): LearnerCohortEntryResponseDto[] {
    const ctxByEnrolment = new Map(
      contexts.map((ctx) => [ctx.enrolment.id, ctx]),
    );

    return rows.filter((row) => {
      const ctx = ctxByEnrolment.get(row.enrolmentId);
      if (!ctx) return false;

      if (
        query.employerOrganisationId &&
        ctx.enrolment.employerOrganisationId !== query.employerOrganisationId
      ) {
        return false;
      }
      if (query.standardId && ctx.enrolment.standardId !== query.standardId) {
        return false;
      }
      if (query.statusBadge && row.statusBadge !== query.statusBadge) {
        return false;
      }
      if (
        query.tutorUserId &&
        ctx.enrolment.tutorUserId !== query.tutorUserId
      ) {
        return false;
      }
      if (query.epaMonth && row.epaDate) {
        if (!row.epaDate.startsWith(query.epaMonth)) {
          return false;
        }
      } else if (query.epaMonth && !row.epaDate) {
        return false;
      }
      return true;
    });
  }

  private applySort(
    rows: LearnerCohortEntryResponseDto[],
    query: ListLearnerCohortQueryDto,
  ): LearnerCohortEntryResponseDto[] {
    const sortBy = query.sortBy ?? 'learnerName';
    const order = query.sortOrder === 'desc' ? -1 : 1;

    const sorted = [...rows];
    sorted.sort((a, b) => {
      const av = this.sortValue(a, sortBy);
      const bv = this.sortValue(b, sortBy);
      if (av < bv) return -1 * order;
      if (av > bv) return 1 * order;
      return 0;
    });
    return sorted;
  }

  private sortValue(
    row: LearnerCohortEntryResponseDto,
    sortBy: string,
  ): string | number {
    switch (sortBy) {
      case 'employerName':
        return row.employerName ?? '';
      case 'standardTitle':
        return row.standardTitle;
      case 'startDate':
        return row.startDate ?? '';
      case 'otjPercent':
        return row.otjPercent ?? -1;
      case 'nextReviewDate':
        return row.nextReviewDate ?? '';
      case 'epaDate':
        return row.epaDate ?? '';
      case 'statusBadge':
        return row.statusBadge;
      case 'tutorName':
        return row.tutorName ?? '';
      case 'learnerName':
      default:
        return row.learnerName;
    }
  }
}
