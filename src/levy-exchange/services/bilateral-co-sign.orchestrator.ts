import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateSignatureRecordDto } from '../../esignature/dto/create-signature-record.dto.js';
import { EsignatureService } from '../../esignature/esignature.service.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';
import { PdfGenerationJob } from '../../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../../pdf/enums/pdf-job-status.enum.js';

import type {
  IBilateralSignResult,
  IBilateralSigningSlot,
} from './bilateral-co-sign.types.js';
import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';
import type { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';

@Injectable()
export class BilateralCoSignOrchestrator {
  constructor(
    private readonly esignatureService: EsignatureService,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
  ) {}

  async executeSign(input: {
    user: AuthenticatedUser;
    organisationId: string;
    pdfOrganisationId: string;
    requestedParty: LevyTransferParty;
    signatureImageKey: string;
    clientIp: string;
    userAgent?: string;
    slots: IBilateralSigningSlot[];
    snapshotPdfJobId: string | null;
  }): Promise<IBilateralSignResult> {
    const next = input.slots.find((s) => s.status === 'pending');
    if (!next) {
      throw new ConflictException('All parties have already signed');
    }
    if (next.party !== input.requestedParty) {
      throw new ConflictException(
        `Next signer is ${next.party}, not ${input.requestedParty}`,
      );
    }
    if (next.signerUserId !== input.user.id && !this.isAdmin(input.user)) {
      throw new ForbiddenException(
        'You are not the assigned signer for this party',
      );
    }

    const createDto: CreateSignatureRecordDto = {
      signatureImageKey: input.signatureImageKey,
    };

    if (next.signOrder === 1) {
      if (!input.snapshotPdfJobId) {
        throw new ConflictException('Agreement PDF has not been requested');
      }
      const pdfJob = await this.pdfJobRepo.findOne({
        where: {
          id: input.snapshotPdfJobId,
          organisationId: input.pdfOrganisationId,
        },
      });
      if (
        !pdfJob ||
        pdfJob.status !== PdfJobStatus.COMPLETED ||
        !pdfJob.outputKey
      ) {
        throw new ConflictException('Agreement PDF is not ready');
      }
      createDto.pdfJobId = pdfJob.id;
    } else {
      if (next.sourcePdfKey) {
        createDto.sourcePdfKey = next.sourcePdfKey;
      } else {
        const previous = input.slots.find(
          (s) => s.signOrder === next.signOrder - 1,
        );
        if (!previous?.signatureRecordId) {
          throw new ConflictException('Previous party has not signed');
        }
        const prevRecord = await this.esignatureService.findOne(
          input.user,
          previous.signatureRecordId,
        );
        if (!prevRecord.signedPdfKey) {
          throw new ConflictException('Previous signed PDF is not available');
        }
        createDto.sourcePdfKey = prevRecord.signedPdfKey;
      }
    }

    const record = await this.esignatureService.createRecord(
      input.user,
      createDto,
      input.clientIp,
      input.userAgent,
    );
    const signed = await this.esignatureService.completeSigning(
      input.user,
      record.id,
    );

    const remaining = input.slots.filter(
      (s) => s.party !== next.party && s.status === 'pending',
    );
    const nextPending = [...remaining].sort(
      (a, b) => a.signOrder - b.signOrder,
    )[0];

    return {
      party: next.party,
      signedPdfKey: signed.signedPdfKey,
      downloadUrl: signed.downloadUrl,
      downloadExpiresAt: signed.downloadExpiresAt,
      signatureRecordId: record.id,
      nextParty: nextPending?.party ?? null,
    };
  }

  private isAdmin(user: AuthenticatedUser): boolean {
    const roles = user.roles ?? [];
    return (
      roles.includes(OrganisationRole.OWNER) ||
      roles.includes(OrganisationRole.ADMIN)
    );
  }
}
