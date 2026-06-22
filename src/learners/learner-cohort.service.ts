import { Injectable } from '@nestjs/common';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { OtjProgressMetricsService } from '../reporting/otj-progress-metrics.service.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { cohortEntriesToCsv } from './cohort-csv.util.js';
import { LearnerCohortEntryResponseDto } from './dto/learner-provider-response.dto.js';
import { ListLearnerCohortQueryDto } from './dto/list-learner-cohort-query.dto.js';
import { LearnerMetricsService } from './learner-metrics.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';

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
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListLearnerCohortQueryDto,
  ): Promise<LearnerCohortResult> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

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
          organisationId,
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

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const total = rows.length;
    const meta = buildPaginationMeta({ page, perPage, total });

    if (query.format === 'csv') {
      return {
        csv: cohortEntriesToCsv(rows),
        meta,
      };
    }

    const start = (page - 1) * perPage;
    const data = rows.slice(start, start + perPage);
    return new PaginatedResult(data, meta);
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
