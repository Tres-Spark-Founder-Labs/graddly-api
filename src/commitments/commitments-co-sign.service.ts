import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AUDIT_ENTITY_TYPE } from '../audit/audit-entity-types.js';
import { AuditEventService } from '../audit/audit-event.service.js';
import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { SequentialCoSignOrchestrator } from '../signing/sequential-co-sign.orchestrator.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';

import { COMMITMENT_SIGNING_ORDER } from './commitment-signing-order.js';
import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { CommitmentStatementsService } from './commitment-statements.service.js';
import { SignCommitmentResponseDto } from './dto/sign-commitment-response.dto.js';
import { SignCommitmentDto } from './dto/sign-commitment.dto.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class CommitmentsCoSignService {
  constructor(
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly groupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentSignature)
    private readonly signatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    private readonly coSignOrchestrator: SequentialCoSignOrchestrator,
    private readonly statusService: CommitmentStatementStatusService,
    private readonly notificationsService: NotificationsService,
    private readonly eifScoreCache: EifScoreCacheService,
    private readonly enrolmentsService: EnrolmentsService,
    private readonly statementsService: CommitmentStatementsService,
    private readonly auditEvents: AuditEventService,
  ) {}

  async sign(
    user: AuthenticatedUser,
    statementId: string,
    dto: SignCommitmentDto,
    clientIp: string,
    userAgent?: string,
  ): Promise<SignCommitmentResponseDto> {
    const organisationId = user.organisationId!;
    /**
     * F1.3.2 — resolved as a *party*, not as the owner.
     *
     * This looked the statement up by `organisationId`, which is the provider
     * who drafted it. An employer signing their own commitment statement got
     * 404 "not found" — the endpoint existed, the guard passed, and the
     * lookup failed one line in. Migration 1781100000026 opens the matching
     * write policy; both are needed.
     */
    const statement = await this.statementsService.findStatementAsParty(
      user,
      statementId,
    );
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
    // Re-read as a party for the same reason as above; scoping this one to
    // the owner would have reintroduced the 404 two lines later.
    const refreshed = await this.statementsService.findStatementAsParty(
      user,
      statementId,
    );
    if (
      !refreshed ||
      refreshed.status !== CommitmentStatementStatus.AWAITING_SIGNATURES
    ) {
      throw new ConflictException(
        'Commitment statement is not ready for signing; ensure snapshot PDF is complete',
      );
    }

    /**
     * Signature rows carry the *statement owner's* organisationId — they are
     * created alongside the statement by the provider — so filtering by the
     * caller's organisation returns nothing for an employer, and the sign
     * would fail with "not ready" rather than a permissions error. Scoped by
     * statement instead, which the party check above has already authorised.
     */
    const signatures = await this.signatureRepo.find({
      where: { statementId },
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

    /**
     * F1.3.3 AC1 — "each signature action".
     *
     * The subscriber does see the save above, as an `update` to a
     * `commitment_signatures` row with `status` moving pending → signed. That
     * is accurate and unreadable: an inspector gets a column diff on a table
     * they have never heard of. This records what happened in the language
     * the document is written in, alongside the signature record that holds
     * the timestamp and IP address.
     */
    await this.auditEvents.recordSignature({
      user,
      entityType: AUDIT_ENTITY_TYPE.COMMITMENT_STATEMENT,
      entityId: refreshed.id,
      organisationId: refreshed.organisationId,
      detail: `version ${refreshed.version} signed as ${dto.party}`,
    });

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

    // PRD order: provider, then employer, then apprentice. See
    // commitment-signing-order.ts for why this is not TRIPARTITE_PARTY_ORDER.
    const slots = COMMITMENT_SIGNING_ORDER.map((party, index) =>
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
    const group = await this.groupRepo.findOne({
      where: { id: statement.groupId },
    });
    if (group) {
      await this.enrolmentsService.syncParticipantsIfUnset(group.enrolmentId, {
        apprenticeUserId: statement.apprenticeUserId,
        tutorUserId: statement.tutorUserId,
        employerManagerUserId: statement.employerManagerUserId,
      });
    }

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
