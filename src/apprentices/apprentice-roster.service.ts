import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  EnrolmentsService,
  type EnrolmentWithDisplayLabels,
} from '../enrolments/enrolments.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';

import {
  APPRENTICE_ROSTER_COLUMN_LABELS,
  daysUntil,
  filterRoster,
  monthLabel,
  normalisePaceStatus,
  rosterStatusLabel,
  sortRoster,
  type IApprenticeRosterRow,
} from './apprentice-roster.rules.js';
import {
  ApprenticeRosterFilter,
  ExportApprenticeRosterDto,
} from './dto/export-apprentice-roster.dto.js';
import { Apprentice } from './entities/apprentice.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IApprenticeRosterContent } from '../pdf/interfaces/pdf-renderer.interface.js';

/** "12 Oct 2026" — the screen's `fmtDate`, in the date's own (UTC) day. */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

/**
 * F1.2.1 AC6 — the PDF half of "exportable as CSV and PDF".
 *
 * ── THE SAME ROWS, IN THE SAME ORDER ────────────────────────────────────────
 *
 * The employer portal composes its roster in the browser: GET /apprentices
 * joined to GET /enrolments, one "best" enrolment per apprentice, then the
 * status pill, the search box, the advanced filters and the column sort. The
 * CSV export writes that composed list, so the file is the table on screen.
 *
 * The PDF cannot be written in the browser, so this service composes the
 * roster the same way — the same two reads, the same choice of enrolment,
 * the same labelling (`EnrolmentsService.enrichEnrolmentsForDisplay`, which
 * is what GET /enrolments serves) — and applies the screen's rules from
 * `apprentice-roster.rules.ts` to the parameters the screen sent. The result
 * is what the person exported, not the unfiltered roster.
 */
@Injectable()
export class ApprenticeRosterService {
  constructor(
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    private readonly enrolmentsService: EnrolmentsService,
    private readonly pdfDispatch: PdfDispatchService,
  ) {}

  /**
   * Queued rather than served inline, like the provider's cohort export: a
   * five-hundred-row landscape table is real rendering work, and this is the
   * pipeline every other PDF on the platform uses. The screen's state travels
   * with the job so the worker rebuilds exactly that table.
   */
  async exportPdf(
    user: AuthenticatedUser,
    query: ExportApprenticeRosterDto,
  ): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    await this.requireEmployer(organisationId);

    const job = await this.pdfDispatch.enqueue({
      organisationId,
      userId: user.id,
      template: PdfJobTemplate.APPRENTICE_ROSTER,
      rosterQuery: { ...query },
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

  /** Runs in the PDF worker, inside the job's tenant context. */
  async buildPdfContent(
    organisationId: string,
    query: ExportApprenticeRosterDto,
  ): Promise<IApprenticeRosterContent> {
    const organisation = await this.requireEmployer(organisationId);

    const roster = await this.buildRows(organisationId);
    const visible = sortRoster(filterRoster(roster, query), query);

    const counts = new Map<string, number>();
    for (const row of visible) {
      const label = rosterStatusLabel(row.status);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return {
      organisationName: organisation.name,
      filterSummary: this.describeFilters(query),
      sortSummary: this.describeSort(query),
      totalCount: visible.length,
      statusCounts: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count })),
      rows: visible.map((row) => ({
        name: row.name,
        employeeId: row.employeeId,
        standard: row.standard,
        provider: row.provider,
        otjProgress: row.otjActual === null ? null : `${row.otjActual}%`,
        epaDate: formatDate(row.epaDateIso),
        lastActivity: formatDate(row.lastActivity),
        statusLabel: rosterStatusLabel(row.status),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * The roster as the screen composes it (`useApprenticeRoster`):
   *
   *   - every apprentice with an enrolment naming this employer — the same
   *     predicate as GET /apprentices for an employer, newest first;
   *   - GET /enrolments for the employer, newest first;
   *   - per apprentice, the enrolment the screen picks: walking the list in
   *     order, the last active one wins, otherwise the first.
   *
   * Nothing here is paged. The screen reads page 1 of each list at 100 rows
   * (`getApprentices`/`getEnrolments` defaults), which is a limit of the
   * screen rather than of the roster, and not one a document should copy.
   */
  private async buildRows(
    organisationId: string,
  ): Promise<IApprenticeRosterRow[]> {
    const apprentices = await this.apprenticeRepo
      .createQueryBuilder('apprentice')
      .where('apprentice.isDeleted = false')
      .andWhere(
        `EXISTS (
           SELECT 1 FROM enrolments e
            WHERE e."apprenticeId" = apprentice.id
              AND e."isDeleted" = false
              AND e."employerOrganisationId" = :organisationId
         )`,
        { organisationId },
      )
      // Same total order as GET /apprentices, ties broken on id, so the
      // unsorted roster prints in the order the screen shows it.
      .orderBy('apprentice.createdAt', 'DESC')
      .addOrderBy('apprentice.id', 'DESC')
      .getMany();

    const enrolments = await this.enrolmentRepo.find({
      where: { isDeleted: false, employerOrganisationId: organisationId },
      // As GET /enrolments orders them, so "the first one" is the same one.
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const enriched =
      await this.enrolmentsService.enrichEnrolmentsForDisplay(enrolments);

    const byApprentice = new Map<string, EnrolmentWithDisplayLabels>();
    for (const enrolment of enriched) {
      const existing = byApprentice.get(enrolment.apprenticeId);
      if (!existing || enrolment.status === EnrolmentStatus.ACTIVE) {
        byApprentice.set(enrolment.apprenticeId, enrolment);
      }
    }

    const now = Date.now();
    return apprentices.map((apprentice) => {
      const enrolment = byApprentice.get(apprentice.id) ?? null;
      return {
        id: apprentice.id,
        name: `${apprentice.firstName ?? ''} ${apprentice.lastName ?? ''}`.trim(),
        employeeId: apprentice.employeeId ?? null,
        standard: enrolment?.standardDisplayName ?? '—',
        provider: enrolment?.providerOrganisationName ?? '—',
        status: normalisePaceStatus(enrolment?.otjPaceAlertLevel),
        epaDateIso: enrolment?.epaDate ?? null,
        startDateIso: enrolment?.plannedStartDate ?? null,
        epaDaysLeft: daysUntil(enrolment?.epaDate, now),
        // Absent from both lists the screen reads (see `normalizeApprentice`),
        // so null here as there — never guessed at.
        otjActual: null,
        attendance: null,
        lastActivity: null,
      };
    });
  }

  private async requireEmployer(organisationId: string): Promise<Organisation> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation || organisation.portalType !== PortalType.EMPLOYER) {
      throw new ForbiddenException(
        'The apprentice roster export is for employer organisations',
      );
    }
    return organisation;
  }

  /** The screen's state, in words, for the face of the document. */
  private describeFilters(query: ExportApprenticeRosterDto): string | null {
    const parts: string[] = [];
    const search = query.search?.trim();
    if (search) parts.push(`search "${search}"`);
    if (query.filter && query.filter !== ApprenticeRosterFilter.ALL) {
      parts.push(
        query.filter === ApprenticeRosterFilter.EPA_IMMINENT
          ? 'EPA under 90 days'
          : `status ${rosterStatusLabel(query.filter)}`,
      );
    }
    if (query.provider) parts.push(`provider ${query.provider}`);
    if (query.standard) parts.push(`standard ${query.standard}`);
    if (query.epaMonth) parts.push(`EPA in ${monthLabel(query.epaMonth)}`);
    if (query.cohort) parts.push(`cohort ${monthLabel(query.cohort)}`);
    return parts.length ? parts.join(', ') : null;
  }

  private describeSort(query: ExportApprenticeRosterDto): string | null {
    if (!query.sortBy) return null;
    const direction = query.sortOrder === 'desc' ? 'descending' : 'ascending';
    return `Sorted by ${APPRENTICE_ROSTER_COLUMN_LABELS[query.sortBy]}, ${direction}.`;
  }
}
