import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { withRlsBootstrap } from '../../common/context/correlation-id-context.js';
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

  /**
   * Whether each of these donors matches anonymously (F4.2.3 AC3), for an
   * SME's view of the applications it has sent. Donors with no active
   * preferences are absent from the map.
   *
   * A counterparty read. `levy_transfer_preferences_select` admits only the
   * owning organisation, so an SME cannot read a donor's preferences under its
   * own policy — the match search reads them because POST /matches/search
   * runs under route-level bootstrap; GET /match-applications does not. Read
   * under the rule on `withRlsBootstrap`: `select` the one flag and the key,
   * never the donor's sectors, regions or per-recipient cap; ids supplied by
   * the caller only from applications it has already read under its own
   * policy; a window holding this read and no other.
   */
  async anonymousMatchingByOrganisation(
    organisationIds: string[],
  ): Promise<Map<string, boolean>> {
    if (organisationIds.length === 0) {
      return new Map();
    }
    const preferences = await withRlsBootstrap(() =>
      this.preferenceRepo.find({
        where: { organisationId: In(organisationIds), isDeleted: false },
        select: ['organisationId', 'anonymousMatching'],
      }),
    );
    return new Map(
      preferences.map((preference) => [
        preference.organisationId,
        preference.anonymousMatching,
      ]),
    );
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
