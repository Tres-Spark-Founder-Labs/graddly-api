import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TransferPreferencesResponseDto } from '../dto/transfer-preferences-response.dto.js';
import { UpsertTransferPreferencesDto } from '../dto/upsert-transfer-preferences.dto.js';
import { LevyTransferPreference } from '../entities/levy-transfer-preference.entity.js';

@Injectable()
export class LevyTransferPreferenceService {
  constructor(
    @InjectRepository(LevyTransferPreference)
    private readonly preferenceRepo: Repository<LevyTransferPreference>,
  ) {}

  async upsert(
    organisationId: string,
    dto: UpsertTransferPreferencesDto,
  ): Promise<TransferPreferencesResponseDto> {
    const existing = await this.preferenceRepo.findOne({
      where: { organisationId, isDeleted: false },
    });

    if (existing) {
      existing.sectors = this.normalizeList(dto.sectors);
      existing.regions = this.normalizeList(dto.regions);
      existing.sizeBands = this.normalizeList(dto.sizeBands);
      existing.programmeTypes = this.normalizeList(dto.programmeTypes);
      existing.maxPerRecipient = dto.maxPerRecipient ?? null;
      existing.openMatching = dto.openMatching;
      existing.anonymousMatching = dto.anonymousMatching;
      return this.toResponse(await this.preferenceRepo.save(existing));
    }

    const created = this.preferenceRepo.create({
      organisationId,
      sectors: this.normalizeList(dto.sectors),
      regions: this.normalizeList(dto.regions),
      sizeBands: this.normalizeList(dto.sizeBands),
      programmeTypes: this.normalizeList(dto.programmeTypes),
      maxPerRecipient: dto.maxPerRecipient ?? null,
      openMatching: dto.openMatching,
      anonymousMatching: dto.anonymousMatching,
    });
    return this.toResponse(await this.preferenceRepo.save(created));
  }

  async get(organisationId: string): Promise<TransferPreferencesResponseDto> {
    const preference = await this.preferenceRepo.findOne({
      where: { organisationId, isDeleted: false },
    });
    if (!preference) {
      throw new NotFoundException('Transfer preferences not found');
    }
    return this.toResponse(preference);
  }

  async findAllActive(): Promise<LevyTransferPreference[]> {
    return this.preferenceRepo.find({
      where: { isDeleted: false },
    });
  }

  async getEntityOrThrow(
    organisationId: string,
  ): Promise<LevyTransferPreference> {
    const preference = await this.preferenceRepo.findOne({
      where: { organisationId, isDeleted: false },
    });
    if (!preference) {
      throw new NotFoundException('Transfer preferences not found');
    }
    return preference;
  }

  private normalizeList(values: string[]): string[] {
    return values
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private toResponse(
    preference: LevyTransferPreference,
  ): TransferPreferencesResponseDto {
    return {
      id: preference.id,
      organisationId: preference.organisationId,
      sectors: preference.sectors,
      regions: preference.regions,
      sizeBands: preference.sizeBands,
      programmeTypes: preference.programmeTypes,
      maxPerRecipient: preference.maxPerRecipient,
      openMatching: preference.openMatching,
      anonymousMatching: preference.anonymousMatching,
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
    };
  }
}
