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

import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { SignCommitmentResponseDto } from './dto/sign-commitment-response.dto.js';
import { SignCommitmentDto } from './dto/sign-commitment.dto.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class CommitmentsCoSignService {
  constructor(
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentSignature)
    private readonly signatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    private readonly coSignOrchestrator: SequentialCoSignOrchestrator,
    private readonly statusService: CommitmentStatementStatusService,
    private readonly notificationsService: NotificationsService,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async sign(
    user: AuthenticatedUser,
    statementId: string,
    dto: SignCommitmentDto,
    clientIp: string,
    userAgent?: string,
  ): Promise<SignCommitmentResponseDto> {
    const organisationId = user.organisationId!;
    const statement = await this.statementRepo.findOne({
      where: { id: statementId, organisationId },
    });
    if (!statement)
      throw new NotFoundException('Commitment statement not found');

    if (
      statement.status === CommitmentStatementStatus.SIGNED ||
      statement.status === CommitmentStatementStatus.SUPERSEDED ||
      statement.status === CommitmentStatementStatus.CANCELLED
    ) {
      throw new ConflictException(
        'Commitment statement is not open for signing',
      );
    }

    await this.initializeForSigning(statement);
    const refreshed = await this.statementRepo.findOne({
      where: { id: statementId, organisationId },
    });
    if (
      !refreshed ||
      refreshed.status !== CommitmentStatementStatus.AWAITING_SIGNATURES
    ) {
      throw new ConflictException(
        'Commitment statement is not ready for signing; ensure snapshot PDF is complete',
      );
    }

    const signatures = await this.signatureRepo.find({
      where: { statementId, organisationId },
      order: { signOrder: 'ASC' },
    });

    const result = await this.coSignOrchestrator.executeSign({
      user,
      organisationId,
      requestedParty: dto.party,
      signatureImageKey: dto.signatureImageKey,
      clientIp,
      userAgent,
      snapshotPdfJobId: refreshed.snapshotPdfJobId,
      slots: signatures.map((s) => ({
        party: s.party,
        signOrder: s.signOrder,
        signerUserId: s.signerUserId,
        status:
          s.status === CommitmentSignatureStatus.SIGNED ? 'signed' : 'pending',
        signatureRecordId: s.signatureRecordId,
      })),
    });

    const nextSlot = signatures.find((s) => s.party === dto.party);
    if (nextSlot) {
      nextSlot.status = CommitmentSignatureStatus.SIGNED;
      nextSlot.signatureRecordId = result.signatureRecordId;
      await this.signatureRepo.save(nextSlot);
    }

    const remaining = signatures.filter(
      (s) =>
        s.id !== nextSlot?.id && s.status === CommitmentSignatureStatus.PENDING,
    );

    if (remaining.length === 0) {
      this.statusService.applyTransition(
        refreshed.status,
        CommitmentStatementStatus.SIGNED,
      );
      refreshed.status = CommitmentStatementStatus.SIGNED;
      refreshed.finalSignedPdfKey = result.signedPdfKey;
      await this.statementRepo.save(refreshed);
      await this.eifScoreCache.invalidate(refreshed.organisationId);
      await this.notifyCompletion(refreshed);
    } else {
      await this.notifyNextSigner(refreshed, result.nextParty);
    }

    return {
      statementId: refreshed.id,
      party: dto.party,
      status: refreshed.status,
      signedPdfKey: result.signedPdfKey,
      downloadUrl: result.downloadUrl,
      downloadExpiresAt: result.downloadExpiresAt,
      nextParty: result.nextParty,
    };
  }

  async initializeForSigning(statement: CommitmentStatement): Promise<void> {
    if (!statement.snapshotPdfJobId) return;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: {
        id: statement.snapshotPdfJobId,
        organisationId: statement.organisationId,
      },
    });
    if (pdfJob?.status === PdfJobStatus.COMPLETED && pdfJob.outputKey) {
      await this.ensureSignatureSlots(statement);
      if (statement.status === CommitmentStatementStatus.SUBMITTED) {
        this.statusService.applyTransition(
          statement.status,
          CommitmentStatementStatus.AWAITING_SIGNATURES,
        );
        statement.status = CommitmentStatementStatus.AWAITING_SIGNATURES;
        await this.statementRepo.save(statement);
      }
    }
  }

  private async ensureSignatureSlots(
    statement: CommitmentStatement,
  ): Promise<void> {
    const existing = await this.signatureRepo.count({
      where: { statementId: statement.id },
    });
    if (existing > 0) return;

    const slots = TRIPARTITE_PARTY_ORDER.map((party, index) =>
      this.signatureRepo.create({
        organisationId: statement.organisationId,
        statementId: statement.id,
        party,
        signOrder: index + 1,
        signerUserId: this.signerIdForParty(statement, party),
        status: CommitmentSignatureStatus.PENDING,
      }),
    );
    await this.signatureRepo.save(slots);
  }

  private signerIdForParty(
    statement: CommitmentStatement,
    party: TripartiteParty,
  ): string {
    switch (party) {
      case TripartiteParty.APPRENTICE:
        return statement.apprenticeUserId;
      case TripartiteParty.TUTOR:
        return statement.tutorUserId;
      case TripartiteParty.EMPLOYER_MANAGER:
        return statement.employerManagerUserId;
    }
  }

  private async notifyCompletion(
    statement: CommitmentStatement,
  ): Promise<void> {
    const userIds = [
      statement.apprenticeUserId,
      statement.tutorUserId,
      statement.employerManagerUserId,
    ];
    for (const userId of userIds) {
      await this.notificationsService.createForUser({
        userId,
        organisationId: statement.organisationId,
        type: NotificationType.COMMITMENT,
        title: 'Commitment statement signed',
        body: `Commitment statement v${statement.version} has been fully signed.`,
        metadata: {
          statementId: statement.id,
          status: CommitmentStatementStatus.SIGNED,
        },
      });
    }
  }

  private async notifyNextSigner(
    statement: CommitmentStatement,
    nextParty: TripartiteParty | null,
  ): Promise<void> {
    if (!nextParty) return;
    const userId = this.signerIdForParty(statement, nextParty);
    await this.notificationsService.createForUser({
      userId,
      organisationId: statement.organisationId,
      type: NotificationType.COMMITMENT,
      title: 'Commitment statement ready to sign',
      body: `Your signature is required on commitment statement v${statement.version}.`,
      metadata: { statementId: statement.id, party: nextParty },
    });
  }
}
