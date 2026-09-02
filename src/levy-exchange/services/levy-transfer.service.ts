import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(DasDonorLink)
    private readonly donorLinkRepo: Repository<DasDonorLink>,
    @InjectRepository(DasDonorOAuthToken)
    private readonly donorTokenRepo: Repository<DasDonorOAuthToken>,
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

    return this.toResponse(transfer);
  }

  async findOne(
    user: AuthenticatedUser,
    transferId: string,
  ): Promise<LevyTransferResponseDto> {
    const transfer = await this.getTransferForOrg(
      user.organisationId!,
      transferId,
    );
    return this.toResponse(transfer);
  }

  async list(
    organisationId: string,
    query: ListTransfersQueryDto,
  ): Promise<PaginatedResult<LevyTransferResponseDto>> {
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
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
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
      refreshed.status = LevyTransferStatus.PENDING_ESFA;
      await this.transferRepo.save(refreshed);
      document.status = LevyTransferDocumentStatus.SIGNED;
      document.signedStorageKey = await this.copyPdfToDonorOrg(
        refreshed,
        result.signedPdfKey,
        organisationId,
      );
      await this.documentRepo.save(document);
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

    const recipient = await this.organisationRepo.findOne({
      where: { id: transfer.recipientOrganisationId, isDeleted: false },
    });
    if (!recipient?.ukprn) {
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
        recipientAccount: recipient.ukprn,
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
    return this.toResponse(saved);
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
    return this.toDocumentResponse(document, organisationId);
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

  private async copyPdfToDonorOrg(
    transfer: LevyTransfer,
    sourceKey: string,
    sourceOrganisationId: string,
  ): Promise<string> {
    const buffer = await this.storage.getObjectBuffer(
      sourceOrganisationId,
      sourceKey,
    );
    const donorKey = this.keyBuilder.build({
      organisationId: transfer.donorOrganisationId,
      category: StorageObjectCategory.EXPORT,
      filename: `levy-transfer-signed-${transfer.id}.pdf`,
      objectId: transfer.id,
    });
    await this.storage.putObject(
      transfer.donorOrganisationId,
      donorKey,
      buffer,
      'application/pdf',
    );
    return donorKey;
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
    organisationId: string,
  ): Promise<LevyTransferDocumentResponseDto> {
    const dto: LevyTransferDocumentResponseDto = {
      id: document.id,
      transferId: document.transferId,
      pdfJobId: document.pdfJobId,
      status: document.status,
    };

    let key = document.signedStorageKey ?? document.unsignedStorageKey;
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

  private toResponse(transfer: LevyTransfer): LevyTransferResponseDto {
    return {
      id: transfer.id,
      donorOrganisationId: transfer.donorOrganisationId,
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
    };
  }
}
