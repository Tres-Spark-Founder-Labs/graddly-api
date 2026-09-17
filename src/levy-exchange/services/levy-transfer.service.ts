import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { withRlsBootstrap } from '../../common/context/correlation-id-context.js';
import { buildPaginationMeta } from '../../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../../common/pagination/paginated-result.js';
import { DAS_CLIENT } from '../../das/das-client.constants.js';
import { Organisation } from '../../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../../pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../../pdf/pdf-dispatch.service.js';
import { StorageObjectCategory } from '../../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../../storage/storage-key.builder.js';
import { StorageService } from '../../storage/storage.service.js';
import { CreateTransferFromMatchDto } from '../dto/create-transfer-from-match.dto.js';
import { LevyTransferDocumentResponseDto } from '../dto/levy-transfer-document-response.dto.js';
import { LevyTransferResponseDto } from '../dto/levy-transfer-response.dto.js';
import {
  ListTransfersQueryDto,
  TransferRoleFilter,
} from '../dto/list-transfers-query.dto.js';
import { SignTransferResponseDto } from '../dto/sign-transfer-response.dto.js';
import { SignTransferDto } from '../dto/sign-transfer.dto.js';
import { DasDonorLink } from '../entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from '../entities/das-donor-oauth-token.entity.js';
import { LevyMatchApplication } from '../entities/levy-match-application.entity.js';
import { LevyTransferDocument } from '../entities/levy-transfer-document.entity.js';
import { LevyTransferSignature } from '../entities/levy-transfer-signature.entity.js';
import { LevyTransfer } from '../entities/levy-transfer.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';
import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';
import { LevyTransferDocumentStatus } from '../enums/levy-transfer-document-status.enum.js';
import {
  LEVY_TRANSFER_PARTY_ORDER,
  LevyTransferParty,
} from '../enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';
import {
  nextSigningParty,
  partyForOrganisation,
  transferActionRequired,
} from '../levy-transfer-signing-state.js';

import { BilateralCoSignOrchestrator } from './bilateral-co-sign.orchestrator.js';
import { DasDonorOAuthService } from './das-donor-oauth.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';
import type { IDasClient } from '../../das/interfaces/das.client.interface.js';

@Injectable()
export class LevyTransferService {
  constructor(
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
    @InjectRepository(LevyTransferDocument)
    private readonly documentRepo: Repository<LevyTransferDocument>,
    @InjectRepository(LevyTransferSignature)
    private readonly signatureRepo: Repository<LevyTransferSignature>,
    @InjectRepository(LevyMatchApplication)
    private readonly matchRepo: Repository<LevyMatchApplication>,
    @InjectRepository(DasDonorLink)
    private readonly donorLinkRepo: Repository<DasDonorLink>,
    @InjectRepository(DasDonorOAuthToken)
    private readonly donorTokenRepo: Repository<DasDonorOAuthToken>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    private readonly pdfDispatch: PdfDispatchService,
    private readonly coSignOrchestrator: BilateralCoSignOrchestrator,
    @Inject(DAS_CLIENT)
    private readonly dasHttpClient: IDasClient,
    private readonly donorOAuth: DasDonorOAuthService,
    private readonly storage: StorageService,
    private readonly keyBuilder: StorageKeyBuilder,
  ) {}

  async createFromMatch(
    user: AuthenticatedUser,
    dto: CreateTransferFromMatchDto,
  ): Promise<LevyTransferResponseDto> {
    const organisationId = user.organisationId!;
    const match = await this.matchRepo.findOne({
      where: { id: dto.matchApplicationId, isDeleted: false },
    });
    if (!match) {
      throw new NotFoundException('Match application not found');
    }
    if (match.status !== LevyMatchApplicationStatus.CONFIRMED) {
      throw new ConflictException('Match application is not confirmed');
    }
    if (match.donorOrganisationId !== organisationId) {
      throw new BadRequestException(
        'Only the donor organisation can create a transfer from this match',
      );
    }

    const transfer = await this.transferRepo.save(
      this.transferRepo.create({
        donorOrganisationId: match.donorOrganisationId,
        recipientOrganisationId: match.recipientOrganisationId,
        matchApplicationId: match.id,
        amount: match.requestedAmount,
        programmeDetails: dto.programmeDetails ?? null,
        status: LevyTransferStatus.DRAFT,
        startDate: dto.startDate ?? null,
        esfaTransferReference: null,
        confirmedAt: null,
        expiryDate: null,
        dasStatusPayload: null,
      }),
    );

    const pdfJob = await this.pdfDispatch.enqueue({
      organisationId: match.donorOrganisationId,
      userId: user.id,
      template: PdfJobTemplate.LEVY_TRANSFER_AGREEMENT,
      transferId: transfer.id,
    });

    await this.documentRepo.save(
      this.documentRepo.create({
        organisationId: match.donorOrganisationId,
        transferId: transfer.id,
        pdfJobId: pdfJob.id,
        unsignedStorageKey: null,
        signedStorageKey: null,
        status: LevyTransferDocumentStatus.PENDING,
      }),
    );

    await this.ensureSignatureSlots(
      transfer,
      user.id,
      dto.recipientSignerUserId,
    );

    return this.respond(user, transfer);
  }

  async findOne(
    user: AuthenticatedUser,
    transferId: string,
  ): Promise<LevyTransferResponseDto> {
    const transfer = await this.getTransferForOrg(
      user.organisationId!,
      transferId,
    );
    return this.respond(user, transfer);
  }

  async list(
    user: AuthenticatedUser,
    query: ListTransfersQueryDto,
  ): Promise<PaginatedResult<LevyTransferResponseDto>> {
    const organisationId = user.organisationId!;
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const qb = this.transferRepo
      .createQueryBuilder('transfer')
      .where('transfer.isDeleted = false');

    if (query.role === TransferRoleFilter.DONOR) {
      qb.andWhere('transfer.donorOrganisationId = :organisationId', {
        organisationId,
      });
    } else if (query.role === TransferRoleFilter.RECIPIENT) {
      qb.andWhere('transfer.recipientOrganisationId = :organisationId', {
        organisationId,
      });
    } else {
      qb.andWhere(
        '(transfer.donorOrganisationId = :organisationId OR transfer.recipientOrganisationId = :organisationId)',
        { organisationId },
      );
    }

    if (query.status) {
      qb.andWhere('transfer.status = :status', { status: query.status });
    }

    qb.orderBy('transfer.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    const slotsByTransfer = await this.loadSlots(rows.map((row) => row.id));
    const donorNames = await this.donorOrganisationNames(rows);
    return new PaginatedResult(
      rows.map((row) =>
        this.toResponse(
          row,
          user,
          slotsByTransfer.get(row.id) ?? [],
          donorNames,
        ),
      ),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async sign(
    user: AuthenticatedUser,
    transferId: string,
    dto: SignTransferDto,
    clientIp: string,
    userAgent?: string,
  ): Promise<SignTransferResponseDto> {
    const organisationId = user.organisationId!;
    const transfer = await this.getTransferForOrg(organisationId, transferId);

    if (
      transfer.status === LevyTransferStatus.PENDING_ESFA ||
      transfer.status === LevyTransferStatus.CONFIRMED ||
      transfer.status === LevyTransferStatus.ACTIVE ||
      transfer.status === LevyTransferStatus.FAILED
    ) {
      throw new ConflictException('Levy transfer is not open for signing');
    }

    await this.initializeForSigning(transfer);
    const refreshed = await this.getTransferForOrg(organisationId, transferId);
    if (refreshed.status !== LevyTransferStatus.PENDING_SIGNATURES) {
      throw new ConflictException(
        'Levy transfer is not ready for signing; ensure agreement PDF is complete',
      );
    }

    const document = await this.getDocumentOrThrow(
      refreshed.donorOrganisationId,
      transferId,
    );
    const signatures = await this.signatureRepo.find({
      where: { transferId, isDeleted: false },
      order: { signOrder: 'ASC' },
    });

    const slots = this.buildSigningSlots(refreshed, signatures, dto.party);

    const result = await this.coSignOrchestrator.executeSign({
      user,
      organisationId,
      pdfOrganisationId: refreshed.donorOrganisationId,
      requestedParty: dto.party,
      signatureImageKey: dto.signatureImageKey,
      clientIp,
      userAgent,
      snapshotPdfJobId: document.pdfJobId,
      slots,
    });

    const signedSlot = signatures.find((s) => s.party === dto.party);
    if (signedSlot) {
      signedSlot.signatureRecordId = result.signatureRecordId;
      signedSlot.signedAt = new Date();
      await this.signatureRepo.save(signedSlot);
    }

    const remaining = signatures.filter(
      (s) => s.party !== dto.party && !s.signedAt,
    );

    if (remaining.length === 0) {
      /**
       * F4.2.4 AC3 — "copies are stored in both the donor's and SME's
       * document libraries". The fully signed PDF was produced in the final
       * signer's storage; each party gets a lasting copy under its own
       * organisation and both keys are recorded. Previously only the donor's
       * copy was made, and the only fully signed thing the recipient ever saw
       * was the temporary URL in its own sign response.
       */
      document.signedStorageKey = await this.copySignedPdf(
        refreshed,
        result.signedPdfKey,
        organisationId,
        refreshed.donorOrganisationId,
      );
      document.recipientSignedStorageKey = await this.copySignedPdf(
        refreshed,
        result.signedPdfKey,
        organisationId,
        refreshed.recipientOrganisationId,
      );
      document.status = LevyTransferDocumentStatus.SIGNED;
      await this.documentRepo.save(document);
      await this.assertDocumentSigned(document.id);

      refreshed.status = LevyTransferStatus.PENDING_ESFA;
      await this.transferRepo.save(refreshed);
    } else if (dto.party === LevyTransferParty.DONOR) {
      document.status = LevyTransferDocumentStatus.READY;
      await this.documentRepo.save(document);
      await this.copyPdfToRecipientOrg(refreshed, result.signedPdfKey);
    }

    return {
      transferId: refreshed.id,
      party: dto.party,
      status: refreshed.status,
      signedPdfKey: result.signedPdfKey,
      downloadUrl: result.downloadUrl,
      downloadExpiresAt: result.downloadExpiresAt,
      nextParty: result.nextParty,
    };
  }

  async submitToDas(
    user: AuthenticatedUser,
    transferId: string,
  ): Promise<LevyTransferResponseDto> {
    const organisationId = user.organisationId!;
    const transfer = await this.getTransferForOrg(organisationId, transferId);

    if (transfer.donorOrganisationId !== organisationId) {
      throw new BadRequestException(
        'Only the donor organisation can submit to DAS',
      );
    }
    if (transfer.status !== LevyTransferStatus.PENDING_ESFA) {
      throw new ConflictException(
        'Transfer must be fully signed before DAS submission',
      );
    }

    const recipientUkprn = await this.recipientUkprn(transfer);
    if (!recipientUkprn) {
      throw new BadRequestException('Recipient organisation has no UKPRN');
    }

    const donorLink = await this.donorLinkRepo.findOne({
      where: {
        organisationId: transfer.donorOrganisationId,
        status: DasDonorLinkStatus.LINKED,
        isDeleted: false,
      },
      order: { updatedAt: 'DESC' },
    });
    if (!donorLink) {
      throw new BadRequestException('Donor DAS account is not linked');
    }

    const accessToken = await this.resolveDonorAccessToken(donorLink.id);
    const startDate =
      transfer.startDate ?? new Date().toISOString().slice(0, 10);

    const consent = await this.dasHttpClient.createLevyTransferConsent(
      {
        amount: transfer.amount,
        recipientAccount: recipientUkprn,
        startDate,
        ukprn: donorLink.ukprn ?? undefined,
      },
      accessToken,
    );

    transfer.esfaTransferReference = consent.reference;
    transfer.dasStatusPayload = consent.raw;
    transfer.status = LevyTransferStatus.CONFIRMED;
    transfer.confirmedAt = new Date();

    const saved = await this.transferRepo.save(transfer);
    return this.respond(user, saved);
  }

  async getDocument(
    user: AuthenticatedUser,
    transferId: string,
  ): Promise<LevyTransferDocumentResponseDto> {
    const organisationId = user.organisationId!;
    const transfer = await this.getTransferForOrg(organisationId, transferId);
    const document = await this.getDocumentOrThrow(
      transfer.donorOrganisationId,
      transferId,
    );
    return this.toDocumentResponse(document, transfer, organisationId);
  }

  async syncTransferStatusFromDas(transfer: LevyTransfer): Promise<void> {
    if (!transfer.esfaTransferReference) {
      return;
    }

    const donorLink = await this.donorLinkRepo.findOne({
      where: {
        organisationId: transfer.donorOrganisationId,
        status: DasDonorLinkStatus.LINKED,
        isDeleted: false,
      },
      order: { updatedAt: 'DESC' },
    });
    if (!donorLink) {
      return;
    }

    const accessToken = await this.resolveDonorAccessToken(donorLink.id);
    const statusPayload = await this.dasHttpClient.fetchTransferStatus(
      transfer.esfaTransferReference,
      accessToken,
    );

    transfer.dasStatusPayload = statusPayload.raw;
    const dasStatus = statusPayload.status?.toLowerCase() ?? '';
    if (dasStatus.includes('active')) {
      transfer.status = LevyTransferStatus.ACTIVE;
    } else if (
      dasStatus.includes('fail') ||
      dasStatus.includes('reject') ||
      dasStatus.includes('cancel')
    ) {
      transfer.status = LevyTransferStatus.FAILED;
    } else if (dasStatus.includes('confirm')) {
      transfer.status = LevyTransferStatus.CONFIRMED;
    }

    await this.transferRepo.save(transfer);
  }

  private async initializeForSigning(transfer: LevyTransfer): Promise<void> {
    const document = await this.getDocumentOrThrow(
      transfer.donorOrganisationId,
      transfer.id,
    );
    if (!document.pdfJobId) {
      return;
    }

    const pdfJob = await this.pdfJobRepo.findOne({
      where: {
        id: document.pdfJobId,
        organisationId: transfer.donorOrganisationId,
      },
    });
    if (pdfJob?.status === PdfJobStatus.COMPLETED && pdfJob.outputKey) {
      if (transfer.status === LevyTransferStatus.DRAFT) {
        transfer.status = LevyTransferStatus.PENDING_SIGNATURES;
        await this.transferRepo.save(transfer);
      }
      if (document.status === LevyTransferDocumentStatus.PENDING) {
        document.status = LevyTransferDocumentStatus.READY;
        document.unsignedStorageKey = pdfJob.outputKey;
        await this.documentRepo.save(document);
      }
    }
  }

  private async ensureSignatureSlots(
    transfer: LevyTransfer,
    donorSignerUserId: string,
    recipientSignerUserId: string,
  ): Promise<void> {
    const existing = await this.signatureRepo.count({
      where: { transferId: transfer.id, isDeleted: false },
    });
    if (existing > 0) {
      return;
    }

    const signerByParty: Record<LevyTransferParty, string> = {
      [LevyTransferParty.DONOR]: donorSignerUserId,
      [LevyTransferParty.RECIPIENT]: recipientSignerUserId,
    };

    const slots = LEVY_TRANSFER_PARTY_ORDER.map((party, index) =>
      this.signatureRepo.create({
        organisationId:
          party === LevyTransferParty.DONOR
            ? transfer.donorOrganisationId
            : transfer.recipientOrganisationId,
        transferId: transfer.id,
        party,
        signOrder: index + 1,
        userId: signerByParty[party],
        signatureRecordId: null,
        signedAt: null,
      }),
    );
    await this.signatureRepo.save(slots);
  }

  private buildSigningSlots(
    transfer: LevyTransfer,
    signatures: LevyTransferSignature[],
    requestedParty: LevyTransferParty,
  ): Array<{
    party: LevyTransferParty;
    signOrder: number;
    signerUserId: string;
    status: 'pending' | 'signed';
    signatureRecordId: string | null;
    sourcePdfKey?: string | null;
  }> {
    const slots = signatures.map((s) => ({
      party: s.party,
      signOrder: s.signOrder,
      signerUserId: s.userId,
      status: s.signedAt ? ('signed' as const) : ('pending' as const),
      signatureRecordId: s.signatureRecordId,
      sourcePdfKey: null as string | null,
    }));

    if (requestedParty === LevyTransferParty.RECIPIENT) {
      const donorSlot = signatures.find(
        (s) => s.party === LevyTransferParty.DONOR,
      );
      const recipientSlot = slots.find(
        (s) => s.party === LevyTransferParty.RECIPIENT,
      );
      if (donorSlot?.signedAt && recipientSlot) {
        recipientSlot.sourcePdfKey = this.recipientChainPdfKey(transfer);
      }
    }

    return slots;
  }

  private recipientChainPdfKey(transfer: LevyTransfer): string {
    return this.keyBuilder.build({
      organisationId: transfer.recipientOrganisationId,
      category: StorageObjectCategory.EXPORT,
      filename: `levy-transfer-chain-${transfer.id}.pdf`,
      objectId: transfer.id,
    });
  }

  /** Copies the fully signed agreement into one party's own storage. */
  private async copySignedPdf(
    transfer: LevyTransfer,
    sourceKey: string,
    sourceOrganisationId: string,
    targetOrganisationId: string,
  ): Promise<string> {
    const buffer = await this.storage.getObjectBuffer(
      sourceOrganisationId,
      sourceKey,
    );
    const targetKey = this.keyBuilder.build({
      organisationId: targetOrganisationId,
      category: StorageObjectCategory.EXPORT,
      filename: `levy-transfer-signed-${transfer.id}.pdf`,
      objectId: transfer.id,
    });
    await this.storage.putObject(
      targetOrganisationId,
      targetKey,
      buffer,
      'application/pdf',
    );
    return targetKey;
  }

  /**
   * An UPDATE the row policies do not admit affects no rows, and save() does
   * not report that. The recipient's completing write is admitted by
   * `levy_transfer_documents_update_recipient_completes`; reading the row back
   * is how a refused write is noticed rather than silently lost.
   */
  private async assertDocumentSigned(documentId: string): Promise<void> {
    const stored = await this.documentRepo.findOne({
      where: { id: documentId, isDeleted: false },
    });
    if (stored?.status !== LevyTransferDocumentStatus.SIGNED) {
      throw new ConflictException(
        'The signed agreement could not be recorded. No copy was marked signed.',
      );
    }
  }

  /**
   * The recipient's UKPRN, for the ESFA consent payload.
   *
   * `organisations_select` admits members only, so the donor cannot read the
   * recipient's organisation — and the recipient's UKPRN is exactly what ESFA
   * needs to be told the transfer is for. This is the counterparty case of the
   * bootstrap rule on `withRlsBootstrap`: one named column of one row, of an
   * organisation this caller is provably party to, read after the caller has
   * been confirmed as this transfer's donor, in a window that holds this read
   * and no other.
   *
   * The caller's own authorisation is NOT this function's job and must have
   * happened already: `submitToDas` establishes the caller is the donor of
   * this transfer before calling it.
   */
  private async recipientUkprn(transfer: LevyTransfer): Promise<string | null> {
    return withRlsBootstrap(async () => {
      const recipient = await this.organisationRepo.findOne({
        where: { id: transfer.recipientOrganisationId, isDeleted: false },
        select: ['ukprn'],
      });
      const ukprn = recipient?.ukprn;
      return typeof ukprn === 'string' && ukprn.trim() !== '' ? ukprn : null;
    });
  }

  /**
   * The donor's name for each transfer, for either party's view of it.
   *
   * `organisations_select` admits members only (1780500000006), so the
   * recipient cannot read the donor's row under its own policy — proved as
   * `graddly_app`: the recipient sees the transfer row and not the donor's
   * organisation row. No policy change, because a policy admits the row
   * (UKPRN, address, contact) and the need is the label.
   *
   * So this is the counterparty case of the rule on `withRlsBootstrap`, as
   * `recipientUkprn` is: `select ['id', 'name']` and nothing else; ids taken
   * only from transfers the caller has already read under its own
   * `levy_transfers` policy; a window holding this read and no other. The
   * name is what the relationship entitles the recipient to — the agreement
   * both parties sign prints it (F4.2.4 AC2).
   */
  private async donorOrganisationNames(
    transfers: LevyTransfer[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(transfers.map((t) => t.donorOrganisationId))];
    if (ids.length === 0) {
      return new Map();
    }
    return withRlsBootstrap(async () => {
      const organisations = await this.organisationRepo.find({
        where: { id: In(ids), isDeleted: false },
        select: ['id', 'name'],
      });
      return new Map(
        organisations.map((organisation) => [
          organisation.id,
          organisation.name,
        ]),
      );
    });
  }

  private async copyPdfToRecipientOrg(
    transfer: LevyTransfer,
    donorSignedPdfKey: string,
  ): Promise<string> {
    const buffer = await this.storage.getObjectBuffer(
      transfer.donorOrganisationId,
      donorSignedPdfKey,
    );
    const recipientKey = this.keyBuilder.build({
      organisationId: transfer.recipientOrganisationId,
      category: StorageObjectCategory.EXPORT,
      filename: `levy-transfer-chain-${transfer.id}.pdf`,
      objectId: transfer.id,
    });
    await this.storage.putObject(
      transfer.recipientOrganisationId,
      recipientKey,
      buffer,
      'application/pdf',
    );
    return recipientKey;
  }

  private async resolveDonorAccessToken(donorLinkId: string): Promise<string> {
    const token = await this.donorTokenRepo.findOne({
      where: { donorLinkId, isDeleted: false },
    });
    if (!token) {
      throw new BadRequestException('Donor OAuth token not found');
    }
    const payload = await this.donorOAuth.refreshToken(token);
    return payload.accessToken;
  }

  private async getTransferForOrg(
    organisationId: string,
    transferId: string,
  ): Promise<LevyTransfer> {
    const transfer = await this.transferRepo.findOne({
      where: [
        {
          id: transferId,
          donorOrganisationId: organisationId,
          isDeleted: false,
        },
        {
          id: transferId,
          recipientOrganisationId: organisationId,
          isDeleted: false,
        },
      ],
    });
    if (!transfer) {
      throw new NotFoundException('Levy transfer not found');
    }
    return transfer;
  }

  private async getDocumentOrThrow(
    donorOrganisationId: string,
    transferId: string,
  ): Promise<LevyTransferDocument> {
    const document = await this.documentRepo.findOne({
      where: {
        transferId,
        organisationId: donorOrganisationId,
        isDeleted: false,
      },
    });
    if (!document) {
      throw new NotFoundException('Levy transfer document not found');
    }
    return document;
  }

  private async toDocumentResponse(
    document: LevyTransferDocument,
    transfer: LevyTransfer,
    organisationId: string,
  ): Promise<LevyTransferDocumentResponseDto> {
    const dto: LevyTransferDocumentResponseDto = {
      id: document.id,
      transferId: document.transferId,
      pdfJobId: document.pdfJobId,
      status: document.status,
    };

    /**
     * Each party's own lasting copy first (F4.2.4 AC3): the donor's is
     * `signedStorageKey`, the recipient's `recipientSignedStorageKey`. A
     * transfer completed before migration 1781100000055 has no recipient copy,
     * so the recipient falls back to the donor's. Before anyone has signed,
     * both parties see the unsigned agreement.
     */
    const ownSignedCopy =
      partyForOrganisation(transfer, organisationId) ===
      LevyTransferParty.RECIPIENT
        ? document.recipientSignedStorageKey
        : document.signedStorageKey;
    let key =
      ownSignedCopy ?? document.signedStorageKey ?? document.unsignedStorageKey;
    if (!key && document.pdfJobId) {
      const pdfJob = await this.pdfJobRepo.findOne({
        where: {
          id: document.pdfJobId,
          organisationId: document.organisationId,
        },
      });
      key = pdfJob?.outputKey ?? null;
    }

    if (!key) {
      return dto;
    }

    const downloadOrgId = this.keyBuilder.belongsToOrganisation(
      key,
      organisationId,
    )
      ? organisationId
      : document.organisationId;

    if (this.keyBuilder.belongsToOrganisation(key, downloadOrgId)) {
      const download = await this.storage.createDownloadUrl(downloadOrgId, {
        key,
      });
      dto.downloadUrl = download.downloadUrl;
      dto.downloadExpiresAt = download.expiresAt.toISOString();
    }

    return dto;
  }

  private toResponse(
    transfer: LevyTransfer,
    user: AuthenticatedUser,
    slots: LevyTransferSignature[],
    donorNames: Map<string, string>,
  ): LevyTransferResponseDto {
    return {
      id: transfer.id,
      donorOrganisationId: transfer.donorOrganisationId,
      donorOrganisationName:
        donorNames.get(transfer.donorOrganisationId) ?? null,
      recipientOrganisationId: transfer.recipientOrganisationId,
      matchApplicationId: transfer.matchApplicationId,
      amount: transfer.amount,
      programmeDetails: transfer.programmeDetails,
      esfaTransferReference: transfer.esfaTransferReference,
      status: transfer.status,
      startDate: transfer.startDate,
      confirmedAt: transfer.confirmedAt?.toISOString() ?? null,
      expiryDate: transfer.expiryDate,
      createdAt: transfer.createdAt.toISOString(),
      updatedAt: transfer.updatedAt.toISOString(),
      signatures: [...slots]
        .sort((a, b) => a.signOrder - b.signOrder)
        .map((slot) => ({
          party: slot.party,
          signOrder: slot.signOrder,
          signed: slot.signedAt !== null,
          signedAt: slot.signedAt ? slot.signedAt.toISOString() : null,
        })),
      nextParty: nextSigningParty(transfer.status, slots),
      actionRequired: transferActionRequired(user, transfer, slots),
    };
  }

  /** One transfer's response for this user, with its signing state. */
  private async respond(
    user: AuthenticatedUser,
    transfer: LevyTransfer,
  ): Promise<LevyTransferResponseDto> {
    const slots = await this.signatureRepo.find({
      where: { transferId: transfer.id, isDeleted: false },
    });
    const donorNames = await this.donorOrganisationNames([transfer]);
    return this.toResponse(transfer, user, slots, donorNames);
  }

  /** Every slot for a page of transfers, in one query, grouped by transfer. */
  private async loadSlots(
    transferIds: string[],
  ): Promise<Map<string, LevyTransferSignature[]>> {
    const byTransfer = new Map<string, LevyTransferSignature[]>();
    if (transferIds.length === 0) {
      return byTransfer;
    }
    const slots = await this.signatureRepo.find({
      where: { transferId: In(transferIds), isDeleted: false },
    });
    for (const slot of slots) {
      const list = byTransfer.get(slot.transferId) ?? [];
      list.push(slot);
      byTransfer.set(slot.transferId, list);
    }
    return byTransfer;
  }
}
