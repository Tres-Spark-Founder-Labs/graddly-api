import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { CommitmentChaseService } from '../../commitments/commitment-chase.service.js';
import { CommitmentSignature } from '../../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatement } from '../../commitments/entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from '../../commitments/enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from '../../commitments/enums/commitment-statement-status.enum.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';
import { LevyTransfer } from '../../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../../levy-exchange/enums/levy-transfer-status.enum.js';
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

@Processor(QUEUE_PDF)
export class PdfGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(PdfGenerationProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly storage: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly levyRoiReportService: LevyRoiReportService,
    private readonly commitmentChaseService: CommitmentChaseService,
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
        buffer = await this.pdfService.renderLevyRoiReport(content);
        filename = `levy-roi-report-${organisationId}.pdf`;
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
      const parties = [
        {
          party: TripartiteParty.APPRENTICE,
          signerUserId: statement.apprenticeUserId,
        },
        {
          party: TripartiteParty.TUTOR,
          signerUserId: statement.tutorUserId,
        },
        {
          party: TripartiteParty.EMPLOYER_MANAGER,
          signerUserId: statement.employerManagerUserId,
        },
      ];
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
