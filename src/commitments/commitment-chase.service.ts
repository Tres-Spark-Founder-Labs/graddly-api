import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';
import { User } from '../users/entities/user.entity.js';

import { CommitmentChaseDispatch } from './entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentChaseKind } from './enums/commitment-chase-kind.enum.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

const CHASE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CommitmentChaseService {
  private readonly logger = new Logger(CommitmentChaseService.name);

  constructor(
    @InjectRepository(CommitmentStatement)
    private readonly statementRepo: Repository<CommitmentStatement>,
    @InjectRepository(CommitmentSignature)
    private readonly signatureRepo: Repository<CommitmentSignature>,
    @InjectRepository(CommitmentChaseDispatch)
    private readonly dispatchRepo: Repository<CommitmentChaseDispatch>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
  ) {}

  async sendDueChases(): Promise<number> {
    const statements = await this.statementRepo.find({
      where: {
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
      },
    });

    let sent = 0;
    for (const statement of statements) {
      const signatures = await this.signatureRepo.find({
        where: { statementId: statement.id },
        order: { signOrder: 'ASC' },
      });

      const pending = signatures.find(
        (row) => row.status === CommitmentSignatureStatus.PENDING,
      );
      if (!pending) {
        continue;
      }

      const turnStart = this.resolveTurnStart(pending, signatures);
      if (Date.now() - turnStart.getTime() < CHASE_AFTER_MS) {
        continue;
      }

      const existing = await this.dispatchRepo.findOne({
        where: {
          signatureId: pending.id,
          chaseKind: CommitmentChaseKind.SEVEN_DAYS,
          isDeleted: false,
        },
      });
      if (existing) {
        continue;
      }

      try {
        await this.notifySigner(statement, pending, {
          isChase: true,
          daysUnsigned: 7,
        });
        await this.dispatchRepo.save(
          this.dispatchRepo.create({
            organisationId: statement.organisationId,
            signatureId: pending.id,
            chaseKind: CommitmentChaseKind.SEVEN_DAYS,
            sentAt: new Date(),
          }),
        );
        sent++;
      } catch (error) {
        this.logger.warn(
          `Commitment chase failed for signature ${pending.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return sent;
  }

  async notifyFirstSigner(
    organisationId: string,
    statementId: string,
  ): Promise<void> {
    const statement = await this.statementRepo.findOne({
      where: { id: statementId, organisationId },
    });
    if (!statement) {
      return;
    }

    const pendingRows = await this.signatureRepo.find({
      where: {
        statementId,
        organisationId,
        status: CommitmentSignatureStatus.PENDING,
      },
      order: { signOrder: 'ASC' },
      take: 1,
    });
    const pending = pendingRows[0];
    if (!pending || pending.signOrder !== 1) {
      return;
    }

    await this.notifySigner(statement, pending, { isChase: false });
  }

  private resolveTurnStart(
    pending: CommitmentSignature,
    signatures: CommitmentSignature[],
  ): Date {
    if (pending.signOrder <= 1) {
      return pending.createdAt;
    }

    const predecessor = signatures
      .filter(
        (row) =>
          row.signOrder < pending.signOrder &&
          row.status === CommitmentSignatureStatus.SIGNED,
      )
      .sort((a, b) => b.signOrder - a.signOrder)[0];

    return predecessor?.updatedAt ?? pending.createdAt;
  }

  private async notifySigner(
    statement: CommitmentStatement,
    signature: CommitmentSignature,
    options: { isChase: boolean; daysUnsigned?: number },
  ): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: signature.signerUserId, isDeleted: false },
    });
    if (!user) {
      return;
    }

    const title = options.isChase
      ? 'Commitment signature reminder'
      : 'Commitment statement ready to sign';
    const body = options.isChase
      ? `Your signature is still required on commitment statement v${statement.version} (${options.daysUnsigned ?? 7} days unsigned).`
      : `Your signature is required on commitment statement v${statement.version}.`;

    await this.notificationsService.createForUser({
      userId: user.id,
      organisationId: statement.organisationId,
      type: NotificationType.COMMITMENT,
      title,
      body,
      metadata: {
        statementId: statement.id,
        party: signature.party,
        chase: options.isChase,
      },
    });

    if (!user.email) {
      return;
    }

    const template = options.isChase
      ? EmailTemplate.COMMITMENT_CHASE
      : EmailTemplate.COMMITMENT_READY_TO_SIGN;

    await this.emailDispatchService.enqueue(
      new SerializedEmailPayload(template, user.email, {
        firstName: user.firstName,
        statementVersion: statement.version,
        partyLabel: this.partyLabel(signature.party),
        daysUnsigned: options.daysUnsigned ?? null,
        appName: this.config.get<string>('app.email.appName', 'Graddly'),
      }),
    );
  }

  private partyLabel(party: TripartiteParty): string {
    switch (party) {
      case TripartiteParty.APPRENTICE:
        return 'Apprentice';
      case TripartiteParty.TUTOR:
        return 'Tutor';
      case TripartiteParty.EMPLOYER_MANAGER:
        return 'Employer manager';
      default:
        return party;
    }
  }
}
