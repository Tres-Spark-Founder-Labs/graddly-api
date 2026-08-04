import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';
import { Review } from '../reviews/entities/review.entity.js';

import { LearnerMetricsService } from './learner-metrics.service.js';

import type {
  TutorCaseloadEntryDto,
  TutorCaseloadResponseDto,
} from './dto/tutor-caseload-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * F2.2.5 AC3 — "alert when any tutor's at-risk count exceeds a configurable
 * threshold (default: 5)".
 */
export const DEFAULT_CASELOAD_AT_RISK_THRESHOLD = 5;

/** The row for learners with no tutor assigned. */
const UNASSIGNED_LABEL = 'Unassigned';

@Injectable()
export class TutorCaseloadService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    private readonly metricsService: LearnerMetricsService,
    private readonly portalService: ReportingPortalService,
    private readonly config: ConfigService,
  ) {}

  get atRiskThreshold(): number {
    return this.config.get<number>(
      'app.caseload.atRiskThreshold',
      DEFAULT_CASELOAD_AT_RISK_THRESHOLD,
    );
  }

  /**
   * F2.2.5 AC2 — the caseload dashboard.
   *
   * At-risk is computed with the same `severityScore > 0` rule the
   * intervention queue uses, deliberately. Two screens that both claim to
   * count at-risk learners must not be able to disagree, and the surest way to
   * make them disagree is to write the rule twice.
   */
  async getCaseload(
    user: AuthenticatedUser,
  ): Promise<TutorCaseloadResponseDto> {
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

    const tutorIds = [
      ...new Set(
        enrolments.map((e) => e.tutorUserId).filter((id): id is string => !!id),
      ),
    ];
    const [tutorNames, complianceByTutor] = await Promise.all([
      this.metricsService.loadTutorNames(tutorIds),
      this.reviewComplianceByTutor(organisationId, tutorIds),
    ]);

    const buckets = new Map<
      string | null,
      { learnerCount: number; atRiskCount: number }
    >();

    for (const context of contexts) {
      const key = context.enrolment.tutorUserId ?? null;
      const bucket = buckets.get(key) ?? { learnerCount: 0, atRiskCount: 0 };
      bucket.learnerCount += 1;
      if (context.severityScore > 0) {
        bucket.atRiskCount += 1;
      }
      buckets.set(key, bucket);
    }

    const threshold = this.atRiskThreshold;
    const tutors: TutorCaseloadEntryDto[] = [...buckets.entries()].map(
      ([tutorUserId, bucket]) => ({
        tutorUserId,
        tutorName: tutorUserId
          ? (tutorNames.get(tutorUserId) ?? 'Unknown tutor')
          : UNASSIGNED_LABEL,
        learnerCount: bucket.learnerCount,
        atRiskCount: bucket.atRiskCount,
        reviewComplianceRate: tutorUserId
          ? (complianceByTutor.get(tutorUserId) ?? null)
          : null,
        exceedsAtRiskThreshold: bucket.atRiskCount > threshold,
      }),
    );

    /**
     * Worst first: most at-risk, then largest caseload. A manager opening this
     * screen is looking for the tutor who needs help, not an alphabetical list.
     * Unassigned sorts naturally to the top when it has at-risk learners, which
     * is correct — nobody is watching those.
     */
    tutors.sort(
      (a, b) =>
        b.atRiskCount - a.atRiskCount || b.learnerCount - a.learnerCount,
    );

    return {
      tutors,
      atRiskThreshold: threshold,
      totalLearners: contexts.length,
      totalAtRisk: contexts.filter((c) => c.severityScore > 0).length,
    };
  }

  /**
   * Percentage of a tutor's reviews that are not overdue.
   *
   * Null rather than 100% for a tutor with no reviews at all. "Nothing
   * scheduled" and "everything on time" are different situations, and the
   * first is the one a programme manager should look at.
   */
  private async reviewComplianceByTutor(
    organisationId: string,
    tutorIds: string[],
  ): Promise<Map<string, number>> {
    if (tutorIds.length === 0) {
      return new Map();
    }

    const rows = await this.reviewRepo
      .createQueryBuilder('r')
      .innerJoin('enrolments', 'e', 'e.id = r."enrolmentId"')
      .select('e."tutorUserId"', 'tutorUserId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE r."isOverdue" = false)', 'onTimeCount')
      .where('r.organisationId = :organisationId', { organisationId })
      .andWhere('r.isDeleted = false')
      .andWhere('e."tutorUserId" IN (:...tutorIds)', { tutorIds })
      .groupBy('e."tutorUserId"')
      .getRawMany<{
        tutorUserId: string;
        total: string;
        onTimeCount: string;
      }>();

    return new Map(
      rows
        .filter((row) => Number(row.total) > 0)
        .map((row) => [
          row.tutorUserId,
          Math.round((Number(row.onTimeCount) / Number(row.total)) * 100),
        ]),
    );
  }

  /**
   * F2.2.5 AC1 — "tutor assignment can be set per learner or in bulk for a
   * cohort".
   *
   * Per learner already existed on the enrolment participants route. This is
   * the bulk half, and it is deliberately a separate endpoint rather than a
   * loop the UI performs: thirty sequential PATCHes is thirty chances to fail
   * halfway and leave a cohort split between two tutors.
   */
  async assignTutorInBulk(
    user: AuthenticatedUser,
    enrolmentIds: string[],
    tutorUserId: string | null,
  ): Promise<{ updated: number }> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const ids = [...new Set(enrolmentIds)];
    if (ids.length === 0) {
      return { updated: 0 };
    }

    /**
     * Loaded and saved rather than a single `update()`, and that is not an
     * oversight — it is what makes AC4 work.
     *
     * F2.2.5 AC4 requires tutor reassignment to reach the audit trail. The
     * trail is written by a TypeORM subscriber, and **subscribers do not fire
     * for QueryBuilder or `update()` writes** (`audit.constants.ts` says so in
     * as many words). A bulk `update()` here would reassign thirty learners
     * and leave no record that anyone did — which is precisely the criterion.
     *
     * The `organisationId` in the `where` still scopes the read, so an id from
     * another provider is simply not found and counts as not updated, rather
     * than being written across a tenant boundary.
     */
    const enrolments = await this.enrolmentRepo.find({
      where: { id: In(ids), organisationId, isDeleted: false },
    });

    for (const enrolment of enrolments) {
      enrolment.tutorUserId = tutorUserId;
    }
    await this.enrolmentRepo.save(enrolments);

    return { updated: enrolments.length };
  }
}
