import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceStatus } from '../portfolio/enums/ks-evidence-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';
import { StorageService } from '../storage/storage.service.js';

import { LearnerDocumentType } from './enums/learner-document-type.enum.js';

import type { LearnerDocumentItemDto } from './dto/learner-document-item.dto.js';
import type { LearnerDocumentsResponseDto } from './dto/learner-documents-response.dto.js';
import type { ListLearnerDocumentsQueryDto } from './dto/list-learner-documents-query.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

interface IRawDocumentItem {
  id: string;
  type: LearnerDocumentType;
  title: string;
  documentAt: Date;
  storageKey: string | null;
  externalUrl: string | null;
}

@Injectable()
export class LearnerDocumentsService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    @InjectRepository(KsEvidenceItem)
    private readonly evidenceRepo: Repository<KsEvidenceItem>,
    private readonly storage: StorageService,
  ) {}

  async listMyDocuments(
    user: AuthenticatedUser,
    query: ListLearnerDocumentsQueryDto,
  ): Promise<LearnerDocumentsResponseDto> {
    const organisationId = user.organisationId!;
    let enrolments = await this.enrolmentRepo.find({
      where: {
        organisationId,
        apprenticeUserId: user.id,
        isDeleted: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (query.enrolmentId) {
      const match = enrolments.find((e) => e.id === query.enrolmentId);
      if (!match) {
        throw new ForbiddenException(
          'Enrolment not found or not linked to your apprentice account',
        );
      }
      enrolments = [match];
    }

    const groups = await Promise.all(
      enrolments.map(async (enrolment) => {
        const rawItems = await this.collectDocuments(
          organisationId,
          enrolment.id,
        );
        const items = await this.attachDownloadUrls(organisationId, rawItems);
        items.sort(
          (a, b) =>
            new Date(b.documentAt).getTime() - new Date(a.documentAt).getTime(),
        );
        return { enrolmentId: enrolment.id, items };
      }),
    );

    return { enrolments: groups };
  }

  private async collectDocuments(
    organisationId: string,
    enrolmentId: string,
  ): Promise<IRawDocumentItem[]> {
    const items: IRawDocumentItem[] = [];

    const group = await this.commitmentGroupRepo.findOne({
      where: { organisationId, enrolmentId, isDeleted: false },
    });
    if (group?.currentVersionId) {
      const statement = await this.commitmentRepo.findOne({
        where: {
          id: group.currentVersionId,
          organisationId,
          status: CommitmentStatementStatus.SIGNED,
        },
      });
      if (statement) {
        const storageKey = await this.resolveCommitmentPdfKey(
          organisationId,
          statement,
        );
        if (storageKey) {
          items.push({
            id: statement.id,
            type: LearnerDocumentType.COMMITMENT,
            title: `Commitment statement (v${statement.version})`,
            documentAt: statement.updatedAt,
            storageKey,
            externalUrl: null,
          });
        }
      }
    }

    const reviews = await this.reviewRepo.find({
      where: {
        organisationId,
        enrolmentId,
        isDeleted: false,
        status: ReviewStatus.COMPLETED,
      },
    });
    for (const review of reviews) {
      const storageKey = await this.resolveReviewPdfKey(organisationId, review);
      items.push({
        id: review.id,
        type: LearnerDocumentType.REVIEW,
        title:
          review.title ??
          `Review on ${review.scheduledAt.toISOString().slice(0, 10)}`,
        documentAt: new Date(review.scheduledAt),
        storageKey,
        externalUrl: null,
      });
    }

    const evidenceItems = await this.evidenceRepo.find({
      where: {
        organisationId,
        enrolmentId,
        isDeleted: false,
        status: KsEvidenceStatus.ACCEPTED,
      },
    });
    for (const evidence of evidenceItems) {
      items.push({
        id: evidence.id,
        type: LearnerDocumentType.EVIDENCE,
        title: evidence.title,
        documentAt: evidence.acceptedAt ?? evidence.updatedAt,
        storageKey: evidence.storageKey,
        externalUrl: evidence.externalUrl,
      });
    }

    return items;
  }

  private async attachDownloadUrls(
    organisationId: string,
    items: IRawDocumentItem[],
  ): Promise<LearnerDocumentItemDto[]> {
    const result: LearnerDocumentItemDto[] = [];
    for (const item of items) {
      const dto: LearnerDocumentItemDto = {
        id: item.id,
        type: item.type,
        title: item.title,
        documentAt: item.documentAt.toISOString(),
        storageKey: item.storageKey,
        externalUrl: item.externalUrl,
      };
      if (item.storageKey) {
        const download = await this.storage.createDownloadUrl(organisationId, {
          key: item.storageKey,
        });
        dto.downloadUrl = download.downloadUrl;
        dto.downloadExpiresAt = download.expiresAt.toISOString();
      }
      result.push(dto);
    }
    return result;
  }

  private async resolveReviewPdfKey(
    organisationId: string,
    review: Review,
  ): Promise<string | null> {
    if (review.finalSignedPdfKey) {
      return review.finalSignedPdfKey;
    }
    if (!review.snapshotPdfJobId) return null;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: {
        id: review.snapshotPdfJobId,
        organisationId,
        status: PdfJobStatus.COMPLETED,
      },
    });
    return pdfJob?.outputKey ?? null;
  }

  private async resolveCommitmentPdfKey(
    organisationId: string,
    statement: CommitmentStatement,
  ): Promise<string | null> {
    if (statement.finalSignedPdfKey) {
      return statement.finalSignedPdfKey;
    }
    if (!statement.snapshotPdfJobId) return null;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: { id: statement.snapshotPdfJobId, organisationId },
    });
    return pdfJob?.outputKey ?? null;
  }
}
