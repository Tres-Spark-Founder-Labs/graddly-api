import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { EpaOutcomeMetricsService } from '../reporting/epa-outcome-metrics.service.js';
import { LearnerOutcomeMetricsService } from '../reporting/learner-outcome-metrics.service.js';
import { User } from '../users/entities/user.entity.js';

import { GenerateSarReportDto } from './dto/generate-sar-report.dto.js';
import { SarReportResponseDto } from './dto/sar-report-response.dto.js';
import { UpdateSarReportDto } from './dto/update-sar-report.dto.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { QipAction } from './entities/qip-action.entity.js';
import {
  SarMetrics,
  SarReport,
  SarSection,
} from './entities/sar-report.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';
import { SarReportStatus } from './enums/sar-report-status.enum.js';
import {
  findSarSectionTemplate,
  SAR_SECTION_TEMPLATES,
} from './sar-template.config.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.1.3 — Self-Assessment Report drafts.
 *
 * **What this service does and does not claim to do.** It assembles the
 * evidence and writes a factual opening paragraph for each section. It does
 * not write the self-assessment, and it never sets a grade. A SAR is a
 * provider's judgement about itself that an inspector will test, and a grade
 * the platform inferred from a readiness percentage would be a number nobody
 * in the room could defend. So: seeded narratives the provider is expected to
 * rewrite, and a `grade` that starts `null` and only ever moves because a
 * human moved it.
 */
@Injectable()
export class SarReportsService {
  constructor(
    @InjectRepository(SarReport)
    private readonly repo: Repository<SarReport>,
    @InjectRepository(QipAction)
    private readonly qipRepo: Repository<QipAction>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly eifCalculator: EifScoreCalculatorService,
    private readonly outcomeMetrics: LearnerOutcomeMetricsService,
    private readonly epaMetrics: EpaOutcomeMetricsService,
  ) {}

  /**
   * AC1 — create the draft for a year, pre-populated from live data.
   *
   * Idempotent by design: asking twice for the same year returns the existing
   * report rather than a second one or an error. The unique index makes two
   * impossible anyway, and a provider clicking "generate" again almost always
   * means "show me the one I started", not "throw mine away".
   */
  async generate(
    user: AuthenticatedUser,
    dto: GenerateSarReportDto,
  ): Promise<SarReportResponseDto> {
    const organisationId = user.organisationId!;

    const existing = await this.repo.findOne({
      where: {
        organisationId,
        academicYear: dto.academicYear,
        isDeleted: false,
      },
    });
    if (existing) {
      return this.toResponse(existing);
    }

    const metrics = await this.buildMetrics(organisationId, user.id);
    const sections = await this.seedSections(organisationId, metrics);

    const row = this.repo.create({
      organisationId,
      academicYear: dto.academicYear,
      status: SarReportStatus.DRAFT,
      sections,
      metrics,
      generatedAt: new Date(),
      generatedByUserId: user.id,
    });

    return this.toResponse(await this.repo.save(row));
  }

  async findAll(user: AuthenticatedUser): Promise<SarReportResponseDto[]> {
    const rows = await this.repo.find({
      where: { organisationId: user.organisationId!, isDeleted: false },
      order: { academicYear: 'DESC' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SarReportResponseDto> {
    return this.toResponse(await this.findEntity(user, id));
  }

  /**
   * AC3 — the draft is editable in the platform.
   *
   * Only `narrative` and `grade` can move, and only for sections that exist
   * in the template. An unknown key is ignored rather than rejected: the
   * template is versioned config, and a client that still knows about a
   * removed section should not have its whole save fail.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateSarReportDto,
  ): Promise<SarReportResponseDto> {
    const row = await this.findEntity(user, id);
    this.assertEditable(row);

    const byKey = new Map(dto.sections.map((s) => [s.key, s]));
    row.sections = row.sections.map((section) => {
      const patch = byKey.get(section.key);
      if (!patch) return section;
      return {
        ...section,
        narrative: patch.narrative ?? section.narrative,
        // `grade: null` is a real instruction (clear it), so the presence of
        // the key matters rather than its truthiness.
        grade: patch.grade === undefined ? section.grade : patch.grade,
      };
    });

    return this.toResponse(await this.repo.save(row));
  }

  /**
   * AC4 — lock the SAR for the period, creating a historical record.
   *
   * The metrics are **recomputed and frozen here**, not carried over from
   * generation. A SAR written over three weeks should be locked against the
   * numbers as they stand on the day the provider signs it off, not the day
   * they first clicked generate — and after this point they never move again,
   * which is what makes the record worth keeping.
   */
  async lock(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SarReportResponseDto> {
    const row = await this.findEntity(user, id);
    this.assertEditable(row);

    const metrics = await this.buildMetrics(row.organisationId, user.id);
    row.metrics = {
      ...metrics,
      lockedByName: await this.userName(user.id),
    };
    row.status = SarReportStatus.LOCKED;
    row.lockedAt = new Date();
    row.lockedByUserId = user.id;

    return this.toResponse(await this.repo.save(row));
  }

  /** Content for the Word export. Locked reports render their frozen data. */
  async getExportContent(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{
    organisationName: string;
    academicYear: string;
    status: SarReportStatus;
    lockedAt: string | null;
    sections: SarSection[];
    metrics: SarMetrics;
  }> {
    const row = await this.findEntity(user, id);
    return {
      organisationName:
        row.metrics?.organisationName ??
        (await this.organisationName(row.organisationId)),
      academicYear: row.academicYear,
      status: row.status,
      lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
      sections: row.sections,
      metrics: row.metrics,
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /** AC1's five inputs, gathered in one place so the SAR cannot half-populate. */
  private async buildMetrics(
    organisationId: string,
    userId: string,
  ): Promise<SarMetrics> {
    const enrolments = await this.enrolmentRepo.find({
      where: { organisationId, isDeleted: false },
      relations: ['apprentice'],
    });

    const inFlightIds = enrolments
      .filter(
        (e) =>
          e.status === EnrolmentStatus.ACTIVE ||
          e.status === EnrolmentStatus.COMPLETED,
      )
      .map((e) => e.id);
    const completedIds = enrolments
      .filter((e) => e.status === EnrolmentStatus.COMPLETED)
      .map((e) => e.id);

    const [
      eif,
      qip,
      reviewComplianceRate,
      epa,
      organisationName,
      generatedByName,
    ] = await Promise.all([
      this.eifCalculator.calculate(organisationId),
      this.qipSummary(organisationId),
      this.outcomeMetrics.reviewComplianceRate(organisationId, inFlightIds),
      this.epaMetrics.passRateForEnrolments(completedIds),
      this.organisationName(organisationId),
      this.userName(userId),
    ]);

    return {
      eifOverallPercent: eif.overallPercent,
      eifCriteria: eif.criteria.map((c) => ({
        slug: c.slug,
        label: c.label,
        percent: c.percent,
        rag: c.rag,
      })),
      qip,
      outcomes: {
        ...this.outcomeMetrics.countByOutcome(enrolments),
        epaPassRate: epa.passRate,
        epaAssessedCount: epa.assessedCount,
      },
      reviewComplianceRate,
      withdrawalRate: this.outcomeMetrics.withdrawalRate(enrolments),
      generatedByName,
      lockedByName: null,
      organisationName,
      capturedAt: new Date().toISOString(),
    };
  }

  private async qipSummary(organisationId: string): Promise<SarMetrics['qip']> {
    const rows = await this.qipRepo.find({
      where: { organisationId, isDeleted: false },
    });
    const total = rows.length;
    const completed = rows.filter(
      (r) => r.status === QipActionStatus.COMPLETED,
    ).length;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = rows.filter(
      (r) =>
        r.status !== QipActionStatus.COMPLETED &&
        r.targetCompletionDate < today,
    ).length;
    return {
      total,
      completed,
      overdue,
      percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  }

  /**
   * The seeded first paragraph of each section.
   *
   * Written as statements of fact with the figure in them, because that is
   * the part a provider would otherwise be copying out of five different
   * screens. The judgement that follows is theirs, and the wording says so
   * rather than pretending the platform reached a conclusion.
   */
  private async seedSections(
    organisationId: string,
    metrics: SarMetrics,
  ): Promise<SarSection[]> {
    const overdueActions = await this.qipRepo.find({
      where: { organisationId, isDeleted: false },
      order: { targetCompletionDate: 'ASC' },
    });

    return SAR_SECTION_TEMPLATES.map((template) => ({
      key: template.key,
      heading: template.heading,
      grade: null,
      narrative: this.seedNarrative(template.key, metrics, overdueActions),
    }));
  }

  private seedNarrative(
    key: string,
    metrics: SarMetrics,
    qipActions: QipAction[],
  ): string {
    const template = findSarSectionTemplate(key);
    const criterion = template?.eifCriterionSlug
      ? metrics.eifCriteria.find((c) => c.slug === template.eifCriterionSlug)
      : undefined;

    if (key === 'provider_context') {
      const o = metrics.outcomes;
      return (
        `${o.activeCount} apprentices are currently in learning, ` +
        `${o.completedCount} have completed, and ${o.withdrawnCount} have ` +
        `left their programme. ` +
        this.rateSentence(
          'The withdrawal rate is',
          metrics.withdrawalRate,
          'No withdrawal rate can be calculated yet.',
        )
      );
    }

    if (key === 'overall_effectiveness') {
      return (
        `Platform readiness across the seven EIF criteria stands at ` +
        `${metrics.eifOverallPercent ?? 0}%. This is a measure of the ` +
        `evidence held in Gradlly, not a judgement — record the ` +
        `self-assessed grade and the reasoning behind it here.`
      );
    }

    if (key === 'areas_for_improvement') {
      const q = metrics.qip;
      if (q.total === 0) {
        return 'No Quality Improvement Plan actions have been recorded yet.';
      }
      const open = qipActions
        .filter((a) => a.status !== QipActionStatus.COMPLETED)
        .slice(0, 5)
        .map((a) => `- ${a.title} (target ${a.targetCompletionDate})`)
        .join('\n');
      return (
        `${q.completed} of ${q.total} QIP actions are complete ` +
        `(${q.percentComplete}%), with ${q.overdue} past their target date.` +
        (open ? `\n\nOpen actions:\n${open}` : '')
      );
    }

    if (key === 'personal_development') {
      // Reviews are the platform's evidence for this judgement area, so the
      // compliance rate belongs in the seeded text rather than only in a table.
      return (
        this.criterionSentence(criterion) +
        ' ' +
        this.rateSentence(
          'Reviews completed on or before their scheduled date:',
          metrics.reviewComplianceRate,
          'No reviews have fallen due yet, so no compliance rate can be calculated.',
        )
      );
    }

    if (key === 'curriculum_impact') {
      const o = metrics.outcomes;
      return (
        this.criterionSentence(criterion) +
        ' ' +
        (o.epaAssessedCount === 0
          ? 'No end-point assessment outcomes have been recorded yet.'
          : `${o.epaPassRate}% of ${o.epaAssessedCount} assessed apprentices ` +
            `passed their end-point assessment.`)
      );
    }

    return this.criterionSentence(criterion);
  }

  private criterionSentence(criterion?: {
    label: string;
    percent: number;
    rag: string;
  }): string {
    if (!criterion) {
      return 'Record your self-assessment for this judgement area.';
    }
    return (
      `Platform evidence for ${criterion.label.toLowerCase()} stands at ` +
      `${criterion.percent}% (${criterion.rag}).`
    );
  }

  /**
   * `null` is not zero, and on a self-assessment the difference matters: 0%
   * compliance is a confession, "not yet measurable" is a fact.
   */
  private rateSentence(
    prefix: string,
    value: number | null,
    fallback: string,
  ): string {
    return value === null ? fallback : `${prefix} ${value}%.`;
  }

  private async findEntity(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SarReport> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) {
      throw new NotFoundException('SAR report not found');
    }
    return row;
  }

  private assertEditable(row: SarReport): void {
    if (row.status === SarReportStatus.LOCKED) {
      throw new ConflictException(
        `The ${row.academicYear} SAR is locked and cannot be changed. ` +
          'Locked reports are kept as a historical record.',
      );
    }
  }

  private async organisationName(organisationId: string): Promise<string> {
    const org = await this.organisationRepo.findOne({
      where: { id: organisationId },
      select: ['name'],
    });
    return org?.name ?? 'Unknown organisation';
  }

  private async userName(userId: string): Promise<string | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['firstName', 'lastName'],
    });
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }

  private toResponse(row: SarReport): SarReportResponseDto {
    const sections = row.sections.map((section) => {
      const template = findSarSectionTemplate(section.key);
      return {
        key: section.key,
        heading: section.heading,
        narrative: section.narrative,
        grade: section.grade,
        graded: template?.graded ?? false,
        eifCriterionSlug: template?.eifCriterionSlug ?? null,
        guidance: template?.guidance ?? '',
      };
    });

    return {
      id: row.id,
      organisationId: row.organisationId,
      academicYear: row.academicYear,
      status: row.status,
      sections,
      metrics: row.metrics,
      generatedAt: row.generatedAt.toISOString(),
      lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
      editable: row.status !== SarReportStatus.LOCKED,
    };
  }
}
