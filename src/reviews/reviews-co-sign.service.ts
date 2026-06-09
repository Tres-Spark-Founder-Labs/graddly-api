import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { SequentialCoSignOrchestrator } from '../signing/sequential-co-sign.orchestrator.js';
import {
  TripartiteParty,
  TRIPARTITE_PARTY_ORDER,
} from '../signing/tripartite-party.enum.js';

import { SignReviewResponseDto } from './dto/sign-review-response.dto.js';
import { SignReviewDto } from './dto/sign-review.dto.js';
import { ReviewSignature } from './entities/review-signature.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewSignatureStatus } from './enums/review-signature-status.enum.js';
import { ReviewSignerParty } from './enums/review-signer-party.enum.js';
import { ReviewStatus } from './enums/review-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ReviewsCoSignService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewSignature)
    private readonly signatureRepo: Repository<ReviewSignature>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    private readonly coSignOrchestrator: SequentialCoSignOrchestrator,
    private readonly notificationsService: NotificationsService,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async sign(
    user: AuthenticatedUser,
    reviewId: string,
    dto: SignReviewDto,
    clientIp: string,
    userAgent?: string,
  ): Promise<SignReviewResponseDto> {
    const organisationId = user.organisationId!;
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId, organisationId, isDeleted: false },
    });
    if (!review) throw new NotFoundException('Review not found');

    if (
      review.status === ReviewStatus.COMPLETED ||
      review.status === ReviewStatus.CANCELLED
    ) {
      throw new ConflictException('Review is not open for signing');
    }

    await this.initializeForSigning(review);
    const refreshed = await this.reviewRepo.findOne({
      where: { id: reviewId, organisationId },
    });
    if (!refreshed || refreshed.status !== ReviewStatus.AWAITING_SIGNATURES) {
      throw new ConflictException(
        'Review is not ready for signing; ensure snapshot PDF is complete',
      );
    }

    const signatures = await this.signatureRepo.find({
      where: { reviewId, organisationId },
      order: { signOrder: 'ASC' },
    });

    const result = await this.coSignOrchestrator.executeSign({
      user,
      organisationId,
      requestedParty: dto.party as unknown as TripartiteParty,
      signatureImageKey: dto.signatureImageKey,
      clientIp,
      userAgent,
      snapshotPdfJobId: refreshed.snapshotPdfJobId,
      slots: signatures.map((s) => ({
        party: s.party as unknown as TripartiteParty,
        signOrder: s.signOrder,
        signerUserId: s.signerUserId,
        status:
          s.status === ReviewSignatureStatus.SIGNED ? 'signed' : 'pending',
        signatureRecordId: s.signatureRecordId,
      })),
    });

    const nextSlot = signatures.find((s) => s.party === dto.party);
    if (nextSlot) {
      nextSlot.status = ReviewSignatureStatus.SIGNED;
      nextSlot.signatureRecordId = result.signatureRecordId;
      await this.signatureRepo.save(nextSlot);
    }

    const remaining = signatures.filter(
      (s) =>
        s.id !== nextSlot?.id && s.status === ReviewSignatureStatus.PENDING,
    );

    if (remaining.length === 0) {
      refreshed.status = ReviewStatus.COMPLETED;
      refreshed.finalSignedPdfKey = result.signedPdfKey;
      await this.reviewRepo.save(refreshed);
      await this.eifScoreCache.invalidate(refreshed.organisationId);
      await this.notifyCompletion(refreshed);
    }

    return {
      reviewId: refreshed.id,
      party: dto.party,
      reviewStatus: refreshed.status,
      signedPdfKey: result.signedPdfKey,
      downloadUrl: result.downloadUrl,
      downloadExpiresAt: result.downloadExpiresAt,
      nextParty: (result.nextParty as ReviewSignerParty | null) ?? null,
    };
  }

  async initializeForSigning(review: Review): Promise<void> {
    if (!review.snapshotPdfJobId) return;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: {
        id: review.snapshotPdfJobId,
        organisationId: review.organisationId,
      },
    });
    if (pdfJob?.status === PdfJobStatus.COMPLETED && pdfJob.outputKey) {
      await this.ensureSignatureSlots(review);
      if (
        review.status === ReviewStatus.IN_PROGRESS ||
        review.status === ReviewStatus.SCHEDULED
      ) {
        review.status = ReviewStatus.AWAITING_SIGNATURES;
        await this.reviewRepo.save(review);
      }
    }
  }

  private async ensureSignatureSlots(review: Review): Promise<void> {
    const existing = await this.signatureRepo.count({
      where: { reviewId: review.id },
    });
    if (existing > 0) return;

    const slots = TRIPARTITE_PARTY_ORDER.map((party, index) =>
      this.signatureRepo.create({
        organisationId: review.organisationId,
        reviewId: review.id,
        party: party as unknown as ReviewSignerParty,
        signOrder: index + 1,
        signerUserId: this.signerIdForParty(review, party),
        status: ReviewSignatureStatus.PENDING,
      }),
    );
    await this.signatureRepo.save(slots);
  }

  private signerIdForParty(review: Review, party: TripartiteParty): string {
    switch (party) {
      case TripartiteParty.APPRENTICE:
        return review.apprenticeUserId;
      case TripartiteParty.TUTOR:
        return review.tutorUserId;
      case TripartiteParty.EMPLOYER_MANAGER:
        return review.employerManagerUserId;
    }
  }

  private async notifyCompletion(review: Review): Promise<void> {
    const userIds = [
      review.apprenticeUserId,
      review.tutorUserId,
      review.employerManagerUserId,
    ];
    for (const userId of userIds) {
      await this.notificationsService.createForUser({
        userId,
        organisationId: review.organisationId,
        type: NotificationType.REVIEW,
        title: 'Review completed',
        body: `Review ${review.id} has been fully signed.`,
        metadata: { reviewId: review.id, status: ReviewStatus.COMPLETED },
      });
    }
  }
}
