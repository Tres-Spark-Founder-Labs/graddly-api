import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { IlrLearnerRecordStatus } from '../ilr/enums/ilr-learner-record-status.enum.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceStatus } from '../portfolio/enums/ks-evidence-status.enum.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';

import { loadEifCriteriaConfig } from './eif-criteria.config.js';
import { percentToEifRag, shouldShowEifAlert } from './eif-rag.util.js';

import type { EifCriterionScoreDto } from './dto/eif-scores-response.dto.js';

const SAFEGUARDING_STUB_PERCENT = 70;
const PROGRAMME_DOCS_STUB_PERCENT = 75;

@Injectable()
export class EifScoreCalculatorService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(IlrLearnerRecord)
    private readonly ilrRepo: Repository<IlrLearnerRecord>,
    @InjectRepository(KsEvidenceItem)
    private readonly evidenceRepo: Repository<KsEvidenceItem>,
    @InjectRepository(Programme)
    private readonly programmeRepo: Repository<Programme>,
  ) {}

  async calculate(organisationId: string): Promise<{
    overallPercent: number;
    alertBanner: boolean;
    criteria: EifCriterionScoreDto[];
    calculatedAt: string;
  }> {
    const [
      otjPercent,
      reviewsPercent,
      commitmentsPercent,
      ilrPercent,
      portfolioPercent,
      programmePercent,
    ] = await Promise.all([
      this.otjOnTrackPercent(organisationId),
      this.reviewsCompletedPercent(organisationId),
      this.commitmentsSignedPercent(organisationId),
      this.ilrValidatedPercent(organisationId),
      this.portfolioAcceptedPercent(organisationId),
      this.programmeDocsPercent(organisationId),
    ]);

    const metricPercents: Record<string, number> = {
      otj: otjPercent,
      reviews: reviewsPercent,
      commitments: commitmentsPercent,
      ilr: ilrPercent,
      portfolio: portfolioPercent,
    };
    metricPercents['programme_docs'] = programmePercent;
    metricPercents['safeguarding_stub'] = SAFEGUARDING_STUB_PERCENT;

    const criteria = loadEifCriteriaConfig().criteria.map((c) => {
      const percent = Math.round(metricPercents[c.metric] ?? 0);
      return {
        slug: c.slug,
        label: c.label,
        percent,
        rag: percentToEifRag(percent),
      };
    });

    const overallPercent = criteria.length
      ? Math.round(
          criteria.reduce((sum, c) => sum + c.percent, 0) / criteria.length,
        )
      : 0;

    return {
      overallPercent,
      alertBanner: shouldShowEifAlert(criteria.map((c) => c.percent)),
      criteria,
      calculatedAt: new Date().toISOString(),
    };
  }

  private async activeEnrolmentIds(organisationId: string): Promise<string[]> {
    const rows = await this.enrolmentRepo.find({
      where: {
        organisationId,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
      select: ['id'],
    });
    return rows.map((r) => r.id);
  }

  private ratioPercent(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.min(100, Math.round((numerator / denominator) * 100));
  }

  private async otjOnTrackPercent(organisationId: string): Promise<number> {
    const enrolmentIds = await this.activeEnrolmentIds(organisationId);
    if (!enrolmentIds.length) return 0;

    let onTrack = 0;
    for (const enrolmentId of enrolmentIds) {
      const latest = await this.otjRepo.findOne({
        where: {
          organisationId,
          enrolmentId,
          isDeleted: false,
          status: OtjLogStatus.APPROVED,
        },
        order: { loggedDate: 'DESC' },
      });
      if (latest?.paceFlag === 'on_track' || latest?.paceFlag === 'at_risk') {
        onTrack += 1;
      } else if (!latest) {
        onTrack += 0;
      }
    }
    return this.ratioPercent(onTrack, enrolmentIds.length);
  }

  private async reviewsCompletedPercent(
    organisationId: string,
  ): Promise<number> {
    const [total, completed] = await Promise.all([
      this.reviewRepo.count({
        where: { organisationId, isDeleted: false },
      }),
      this.reviewRepo.count({
        where: {
          organisationId,
          isDeleted: false,
          status: ReviewStatus.COMPLETED,
        },
      }),
    ]);
    return this.ratioPercent(completed, total);
  }

  private async commitmentsSignedPercent(
    organisationId: string,
  ): Promise<number> {
    const enrolmentIds = await this.activeEnrolmentIds(organisationId);
    if (!enrolmentIds.length) return 0;

    let signed = 0;
    for (const enrolmentId of enrolmentIds) {
      const statement = await this.commitmentRepo
        .createQueryBuilder('statement')
        .innerJoin('statement.group', 'grp')
        .where('statement.organisationId = :organisationId', { organisationId })
        .andWhere('grp.enrolmentId = :enrolmentId', { enrolmentId })
        .andWhere('statement.status = :status', {
          status: CommitmentStatementStatus.SIGNED,
        })
        .orderBy('statement.version', 'DESC')
        .getOne();
      if (statement) signed += 1;
    }
    return this.ratioPercent(signed, enrolmentIds.length);
  }

  private async ilrValidatedPercent(organisationId: string): Promise<number> {
    const [total, validated] = await Promise.all([
      this.ilrRepo.count({ where: { organisationId, isDeleted: false } }),
      this.ilrRepo.count({
        where: {
          organisationId,
          isDeleted: false,
          status: IlrLearnerRecordStatus.VALIDATED,
        },
      }),
    ]);
    return this.ratioPercent(validated, total);
  }

  private async portfolioAcceptedPercent(
    organisationId: string,
  ): Promise<number> {
    const enrolmentIds = await this.activeEnrolmentIds(organisationId);
    if (!enrolmentIds.length) return 0;

    let withAccepted = 0;
    for (const enrolmentId of enrolmentIds) {
      const count = await this.evidenceRepo.count({
        where: {
          organisationId,
          enrolmentId,
          isDeleted: false,
          status: KsEvidenceStatus.ACCEPTED,
        },
      });
      if (count > 0) withAccepted += 1;
    }
    return this.ratioPercent(withAccepted, enrolmentIds.length);
  }

  private async programmeDocsPercent(organisationId: string): Promise<number> {
    const count = await this.programmeRepo.count({
      where: { organisationId, isDeleted: false },
    });
    if (count === 0) return PROGRAMME_DOCS_STUB_PERCENT;
    return Math.min(100, 60 + count * 5);
  }
}
