import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Programme } from '../programmes/entities/programme.entity.js';
import { ProgrammeStatus } from '../programmes/enums/programme-status.enum.js';

import { CreateProgrammeDocumentDto } from './dto/create-programme-document.dto.js';
import { ProgrammeDocumentResponseDto } from './dto/programme-document-response.dto.js';
import { EifScoreCacheService } from './eif-score-cache.service.js';
import { ProgrammeDocument } from './entities/programme-document.entity.js';
import { REQUIRED_PROGRAMME_DOCUMENT_TYPES } from './enums/programme-document-type.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ProgrammeDocumentsService {
  constructor(
    @InjectRepository(ProgrammeDocument)
    private readonly docRepo: Repository<ProgrammeDocument>,
    @InjectRepository(Programme)
    private readonly programmeRepo: Repository<Programme>,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async listForProgramme(
    user: AuthenticatedUser,
    programmeId: string,
  ): Promise<ProgrammeDocumentResponseDto[]> {
    const organisationId = user.organisationId!;
    await this.getProgrammeOrThrow(organisationId, programmeId);

    const docs = await this.docRepo.find({
      where: { organisationId, programmeId, isDeleted: false },
      order: { documentType: 'ASC' },
    });
    return docs.map((doc) => this.toResponse(doc));
  }

  async attach(
    user: AuthenticatedUser,
    programmeId: string,
    dto: CreateProgrammeDocumentDto,
  ): Promise<ProgrammeDocumentResponseDto> {
    const organisationId = user.organisationId!;
    await this.getProgrammeOrThrow(organisationId, programmeId);

    const existing = await this.docRepo.findOne({
      where: {
        organisationId,
        programmeId,
        documentType: dto.documentType,
        isDeleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Document of type ${dto.documentType} already exists for this programme`,
      );
    }

    const entity = this.docRepo.create({
      organisationId,
      programmeId,
      documentType: dto.documentType,
      storageKey: dto.storageKey.trim(),
      uploadedAt: new Date(),
    });
    const saved = await this.docRepo.save(entity);
    await this.eifScoreCache.invalidate(organisationId);
    return this.toResponse(saved);
  }

  async coveragePercent(organisationId: string): Promise<number> {
    const activeProgrammes = await this.programmeRepo.find({
      where: {
        organisationId,
        status: ProgrammeStatus.ACTIVE,
        isDeleted: false,
      },
      select: ['id'],
    });
    if (activeProgrammes.length === 0) {
      return 0;
    }

    const requiredSlots =
      activeProgrammes.length * REQUIRED_PROGRAMME_DOCUMENT_TYPES.length;
    let filled = 0;

    for (const programme of activeProgrammes) {
      const docs = await this.docRepo.find({
        where: {
          organisationId,
          programmeId: programme.id,
          isDeleted: false,
        },
        select: ['documentType'],
      });
      const types = new Set(docs.map((d) => d.documentType));
      for (const required of REQUIRED_PROGRAMME_DOCUMENT_TYPES) {
        if (types.has(required)) {
          filled += 1;
        }
      }
    }

    return Math.round((filled / requiredSlots) * 100);
  }

  private async getProgrammeOrThrow(
    organisationId: string,
    programmeId: string,
  ): Promise<Programme> {
    const programme = await this.programmeRepo.findOne({
      where: { id: programmeId, organisationId, isDeleted: false },
    });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    return programme;
  }

  private toResponse(doc: ProgrammeDocument): ProgrammeDocumentResponseDto {
    return {
      id: doc.id,
      programmeId: doc.programmeId,
      documentType: doc.documentType,
      storageKey: doc.storageKey,
      uploadedAt: doc.uploadedAt.toISOString(),
    };
  }
}
