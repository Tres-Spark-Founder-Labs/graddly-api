import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { CommitmentAuditTrailService } from '../../commitments/commitment-audit-trail.service.js';
import { CommitmentChaseService } from '../../commitments/commitment-chase.service.js';
import { COMMITMENT_SIGNING_ORDER } from '../../commitments/commitment-signing-order.js';
import { CommitmentSignature } from '../../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatement } from '../../commitments/entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from '../../commitments/enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from '../../commitments/enums/commitment-statement-status.enum.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { ListLearnerCohortQueryDto } from '../../learners/dto/list-learner-cohort-query.dto.js';
import { LearnerCohortService } from '../../learners/learner-cohort.service.js';
import { LevyTransfer } from '../../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../../levy-exchange/enums/levy-transfer-status.enum.js';
import { QipActionsService } from '../../ofsted/qip-actions.service.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../../pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../../pdf/enums/pdf-job-template.enum.js';
import { PDF_JOB_GENERATE } from '../../pdf/pdf-job.constants.js';
import { PdfService } from '../../pdf/pdf.service.js';
import { LevyRoiReportService } from '../../reporting/levy-roi-report.service.js';
import { ReviewRecord } from '../../reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../../reviews/entities/review-signature.entity.js';
import { Review } from '../../reviews/entities/review.entity.js';
import { ReviewSignatureStatus } from '../../reviews/enums/review-signature-status.enum.js';
import { ReviewSignerParty } from '../../reviews/enums/review-signer-party.enum.js';
import { ReviewStatus } from '../../reviews/enums/review-status.enum.js';
import { TripartiteParty } from '../../signing/tripartite-party.enum.js';
import { StorageObjectCategory } from '../../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../../storage/storage-key.builder.js';
import { StorageService } from '../../storage/storage.service.js';
import { QUEUE_PDF } from '../bullmq.constants.js';

import type { CommitmentStatementContentDto } from '../../commitments/dto/commitment-statement-content.dto.js';
import type {
  ICommitmentSnapshotContent,
  ILevyTransferAgreementContent,
  IReviewSnapshotContent,
} from '../../pdf/interfaces/pdf-renderer.interface.js';
import type { IPdfJobPayload } from '../../pdf/pdf-job.payload.js';
import type { ReviewRecordPayloadDto } from '../../reviews/dto/review-record-payload.dto.js';

/** Keeps a slow logo host from eating the AC3 ten-second budget. */
const LOGO_FETCH_TIMEOUT_MS = 3000;

@Processor(QUEUE_PDF)
export class PdfGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfGenerationProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly levyRoiReportService: LevyRoiReportService,
    private readonly commitmentChaseService: CommitmentChaseService,
    private readonly commitmentAuditTrailService: CommitmentAuditTrailService,
    private readonly qipActionsService: QipActionsService,
    @InjectRepository(PdfGenerationJob)
    private readonly jobRepo: Repository<PdfGenerationJob>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewRecord)
    private readonly reviewRecordRepo: Repository<ReviewRecord>,
    @InjectRepository(ReviewSignature)
    private readonly reviewSignatureRepo: Repository<ReviewSignature>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentStatementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentSignature)
    private readonly commitmentSignatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(LevyTransfer)
    private readonly levyTransferRepo: Repository<LevyTransfer>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    // F2.2.1 AC5. Appended last on purpose: `test/helpers/process-pdf-job.ts`
    // builds this class by hand with positional arguments, so inserting a
    // parameter mid-list silently shifts every one after it. That has already
    // cost seven e2e suites once.
    private readonly learnerCohortService: LearnerCohortService,
  ) {
    super();
  }

  async process(job: Job<IPdfJobPayload>): Promise<void> {
    if (job.name !== PDF_JOB_GENERATE) {
      this.logger.warn(
        `Unknown job name "${job.name}" on ${QUEUE_PDF} queue (job ${job.id})`,
      );
      return;
    }

    const {
      jobId,
      organisationId,
      userId,
      template,
      reviewId,
      statementId,
      transferId,
    } = job.data;
    setCurrentUserId(userId);
    setCurrentOrganisationId(organisationId);
    setLastKnownUserIdForGuc(userId);

    await this.jobRepo.update(jobId, { status: PdfJobStatus.PROCESSING });

    try {
      let buffer: Buffer;
      let filename: string;

      if (template === PdfJobTemplate.REVIEW_SNAPSHOT) {
        if (!reviewId) {
          throw new Error('reviewId is required for review_snapshot template');
        }
        const content = await this.buildReviewSnapshotContent(
          organisationId,
          reviewId,
        );
        buffer = await this.pdfService.renderReviewSnapshot(content);
        filename = `review-snapshot-${reviewId}.pdf`;
      } else if (template === PdfJobTemplate.COMMITMENT_SNAPSHOT) {
        if (!statementId) {
          throw new Error(
            'statementId is required for commitment_snapshot template',
          );
        }
        const content = await this.buildCommitmentSnapshotContent(
          organisationId,
          statementId,
        );
        buffer = await this.pdfService.renderCommitmentSnapshot(content);
        filename = `commitment-snapshot-${statementId}.pdf`;
      } else if (template === PdfJobTemplate.LEVY_TRANSFER_AGREEMENT) {
        if (!transferId) {
          throw new Error(
            'transferId is required for levy_transfer_agreement template',
          );
        }
        const content =
          await this.buildLevyTransferAgreementContent(transferId);
        buffer = await this.pdfService.renderLevyTransferAgreement(content);
        filename = `levy-transfer-agreement-${transferId}.pdf`;
      } else if (template === PdfJobTemplate.LEVY_ROI_REPORT) {
        const content =
          await this.levyRoiReportService.buildPdfContent(organisationId);
        // F1.1.5 AC2: PDFKit cannot draw from a URL, so resolve the employer
        // logo to bytes here. Never let a missing or slow logo fail the report.
        const logoBytes = await this.fetchLogoBytes(content.logoUrl);
        buffer = await this.pdfService.renderLevyRoiReport({
          ...content,
          logoBytes,
        });
        filename = `levy-report-${organisationId}.pdf`;
      } else if (template === PdfJobTemplate.COMMITMENT_AUDIT_TRAIL) {
        if (!statementId) {
          throw new Error(
            'statementId is required for commitment_audit_trail template',
          );
        }
        // F1.3.3 AC3. The service re-checks party membership itself before
        // it lifts the RLS bootstrap flag to read the provider's audit rows.
        const content = await this.commitmentAuditTrailService.buildPdfContent({
          organisationId,
          statementId,
          requestedByUserId: userId,
        });
        buffer = await this.pdfService.renderCommitmentAuditTrail(content);
        filename = `commitment-audit-trail-${statementId}.pdf`;
      } else if (template === PdfJobTemplate.PROVIDER_COMPARISON) {
        // F1.4.2 AC3.
        const content =
          await this.levyRoiReportService.buildProviderComparisonContent(
            organisationId,
          );
        const logoBytes = await this.fetchLogoBytes(
          (
            await this.organisationRepo.findOne({
              where: { id: organisationId },
              select: ['logoUrl'],
            })
          )?.logoUrl ?? null,
        );
        buffer = await this.pdfService.renderProviderComparison({
          ...content,
          logoBytes,
        });
        filename = `provider-comparison-${organisationId}.pdf`;
      } else if (template === PdfJobTemplate.QIP_PLAN) {
        // F2.1.2 AC5.
        const content = await this.qipActionsService.buildPlanContent(
          organisationId,
          userId,
        );
        const logoBytes = await this.fetchLogoBytes(
          (
            await this.organisationRepo.findOne({
              where: { id: organisationId },
              select: ['logoUrl'],
            })
          )?.logoUrl ?? null,
        );
        buffer = await this.pdfService.renderQipPlan({
          ...content,
          logoBytes,
        });
        filename = `quality-improvement-plan-${organisationId}.pdf`;
      } else if (template === PdfJobTemplate.LEARNER_COHORT) {
        // F2.2.1 AC5. The filters travelled with the job, so the document is
        // the table the provider exported rather than their whole cohort.
        const content = await this.learnerCohortService.buildPdfContent(
          organisationId,
          (job.data.cohortQuery ?? {}) as unknown as ListLearnerCohortQueryDto,
        );
        const logoBytes = await this.fetchLogoBytes(
          (
            await this.organisationRepo.findOne({
              where: { id: organisationId },
              select: ['logoUrl'],
            })
          )?.logoUrl ?? null,
        );
        buffer = await this.pdfService.renderLearnerCohort({
          ...content,
          logoBytes,
        });
        filename = `learner-cohort-${organisationId}.pdf`;
      } else {
        buffer = await this.pdfService.renderHelloPdf();
        filename = `hello-${jobId}.pdf`;
      }

      const outputKey = this.keyBuilder.build({
        organisationId,
        category: StorageObjectCategory.EXPORT,
        filename,
        objectId: jobId,
      });

      await this.storage.putObject(
        organisationId,
        outputKey,
        buffer,
        'application/pdf',
      );

      await this.jobRepo.update(jobId, {
        status: PdfJobStatus.COMPLETED,
        outputKey,
        completedAt: new Date(),
        errorMessage: null,
      });

      if (template === PdfJobTemplate.REVIEW_SNAPSHOT && reviewId) {
        await this.prepareReviewSigning(organisationId, reviewId);
      }
      if (template === PdfJobTemplate.COMMITMENT_SNAPSHOT && statementId) {
        await this.prepareCommitmentSigning(organisationId, statementId);
        await this.commitmentChaseService.notifyFirstSigner(
          organisationId,
          statementId,
        );
      }
      if (template === PdfJobTemplate.LEVY_TRANSFER_AGREEMENT && transferId) {
        await this.prepareLevyTransferSigning(transferId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'PDF generation failed';
      await this.jobRepo.update(jobId, {
        status: PdfJobStatus.FAILED,
        errorMessage: message,
      });
      throw error;
    }
  }

  private async buildReviewSnapshotContent(
    organisationId: string,
    reviewId: string,
  ): Promise<IReviewSnapshotContent> {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId, organisationId, isDeleted: false },
      relations: ['apprentice'],
    });
    if (!review) {
      throw new Error('Review not found for snapshot');
    }
    const record = await this.reviewRecordRepo.findOne({
      where: { reviewId, organisationId },
    });
    const payload = record?.payload as ReviewRecordPayloadDto | undefined;
    return {
      title: review.title,
      scheduledAt: review.scheduledAt.toISOString().slice(0, 10),
      apprenticeName: review.apprentice
        ? `${review.apprentice.firstName} ${review.apprentice.lastName}`
        : 'Apprentice',
      progressSummary: payload?.progressSummary,
      actionsAgreed: payload?.actionsAgreed,
      employerComments: payload?.employerComments,
      smartGoals: payload?.smartGoals,
      wellbeingScore: payload?.wellbeing?.score,
      wellbeingNotes: payload?.wellbeing?.notes,
    };
  }

  private async buildCommitmentSnapshotContent(
    organisationId: string,
    statementId: string,
  ): Promise<ICommitmentSnapshotContent> {
    const statement = await this.commitmentStatementRepo.findOne({
      where: { id: statementId, organisationId },
      relations: ['group', 'group.apprentice'],
    });
    if (!statement) {
      throw new Error('Commitment statement not found for snapshot');
    }
    const content =
      statement.content as unknown as CommitmentStatementContentDto;
    const apprentice = statement.group?.apprentice;
    return {
      version: statement.version,
      apprenticeName: apprentice
        ? `${apprentice.firstName} ${apprentice.lastName}`
        : 'Apprentice',
      trainingPlanSummary: content.trainingPlanSummary,
      employerCommitments: content.employerCommitments,
      apprenticeCommitments: content.apprenticeCommitments,
      providerCommitments: content.providerCommitments,
      weeklyHours: content.weeklyHours,
      additionalTerms: content.additionalTerms,
    };
  }

  /**
   * F1.1.5 AC2 — resolve an employer logo URL to bytes for embedding.
   *
   * Deliberately forgiving: a branded report is desirable, a failed report is
   * not. A missing logo, an unreachable host, a slow response, or a non-image
   * payload all degrade to "no logo" rather than failing the job. The timeout
   * also protects AC3's ten-second budget from a hanging fetch.
   */
  private async fetchLogoBytes(logoUrl: string | null): Promise<Buffer | null> {
    if (!logoUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(logoUrl, { signal: controller.signal });
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') ?? '';
      // PDFKit supports PNG and JPEG only; an SVG logo would throw.
      if (!/image\/(png|jpe?g)/i.test(contentType)) return null;

      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.byteLength > 0 ? bytes : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async buildLevyTransferAgreementContent(
    transferId: string,
  ): Promise<ILevyTransferAgreementContent> {
    const transfer = await this.levyTransferRepo.findOne({
      where: { id: transferId, isDeleted: false },
    });
    if (!transfer) {
      throw new Error('Levy transfer not found for agreement PDF');
    }

    const [donor, recipient] = await Promise.all([
      this.organisationRepo.findOne({
        where: { id: transfer.donorOrganisationId, isDeleted: false },
      }),
      this.organisationRepo.findOne({
        where: { id: transfer.recipientOrganisationId, isDeleted: false },
      }),
    ]);

    return {
      donorOrganisationName: donor?.name ?? 'Donor organisation',
      recipientOrganisationName: recipient?.name ?? 'Recipient organisation',
      amount: transfer.amount,
      startDate: transfer.startDate,
      programmeDetails: transfer.programmeDetails,
    };
  }

  private async prepareLevyTransferSigning(transferId: string): Promise<void> {
    const transfer = await this.levyTransferRepo.findOne({
      where: { id: transferId, isDeleted: false },
    });
    if (!transfer || transfer.status !== LevyTransferStatus.DRAFT) {
      return;
    }
    transfer.status = LevyTransferStatus.PENDING_SIGNATURES;
    await this.levyTransferRepo.save(transfer);
  }

  private async prepareCommitmentSigning(
    organisationId: string,
    statementId: string,
  ): Promise<void> {
    const statement = await this.commitmentStatementRepo.findOne({
      where: { id: statementId, organisationId },
    });
    if (!statement) return;

    const existing = await this.commitmentSignatureRepo.count({
      where: { statementId },
    });
    if (existing === 0) {
      /**
       * Derived from COMMITMENT_SIGNING_ORDER rather than listed again.
       *
       * This array previously hardcoded apprentice-tutor-employer, a second
       * copy of the same order that `commitments-co-sign.service.ts` held —
       * so the PRD's provider-employer-apprentice sequence had to be fixed in
       * two places or the two paths would create signature slots in different
       * orders depending on which one ran first.
       */
      const signerIdByParty = {
        [TripartiteParty.APPRENTICE]: statement.apprenticeUserId,
        [TripartiteParty.TUTOR]: statement.tutorUserId,
        [TripartiteParty.EMPLOYER_MANAGER]: statement.employerManagerUserId,
      };
      const parties = COMMITMENT_SIGNING_ORDER.map((party) => ({
        party,
        signerUserId: signerIdByParty[party],
      }));
      await this.commitmentSignatureRepo.save(
        parties.map((p, index) =>
          this.commitmentSignatureRepo.create({
            organisationId,
            statementId,
            party: p.party,
            signOrder: index + 1,
            signerUserId: p.signerUserId,
            status: CommitmentSignatureStatus.PENDING,
          }),
        ),
      );
    }

    if (statement.status === CommitmentStatementStatus.SUBMITTED) {
      statement.status = CommitmentStatementStatus.AWAITING_SIGNATURES;
      await this.commitmentStatementRepo.save(statement);
    }
  }

  private async prepareReviewSigning(
    organisationId: string,
    reviewId: string,
  ): Promise<void> {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId, organisationId, isDeleted: false },
    });
    if (!review) return;

    const existing = await this.reviewSignatureRepo.count({
      where: { reviewId },
    });
    if (existing === 0) {
      const parties = [
        {
          party: ReviewSignerParty.APPRENTICE,
          signerUserId: review.apprenticeUserId,
        },
        {
          party: ReviewSignerParty.TUTOR,
          signerUserId: review.tutorUserId,
        },
        {
          party: ReviewSignerParty.EMPLOYER_MANAGER,
          signerUserId: review.employerManagerUserId,
        },
      ];
      await this.reviewSignatureRepo.save(
        parties.map((p, index) =>
          this.reviewSignatureRepo.create({
            organisationId,
            reviewId,
            party: p.party,
            signOrder: index + 1,
            signerUserId: p.signerUserId,
            status: ReviewSignatureStatus.PENDING,
          }),
        ),
      );
    }

    if (
      review.status === ReviewStatus.SCHEDULED ||
      review.status === ReviewStatus.IN_PROGRESS
    ) {
      review.status = ReviewStatus.AWAITING_SIGNATURES;
      await this.reviewRepo.save(review);
    }
  }
}
