import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../../common/pagination/paginated-result.js';
import { RecipientProfileResponseDto } from '../dto/recipient-profile-response.dto.js';
import { SearchRecipientDirectoryDto } from '../dto/search-recipient-directory.dto.js';
import { UpsertRecipientProfileDto } from '../dto/upsert-recipient-profile.dto.js';
import { LevyRecipientProfile } from '../entities/levy-recipient-profile.entity.js';
import { normaliseOpenVocabularyValue } from '../levy-vocabulary.js';

@Injectable()
export class LevyRecipientProfileService {
  constructor(
    @InjectRepository(LevyRecipientProfile)
    private readonly profileRepo: Repository<LevyRecipientProfile>,
  ) {}

  async upsert(
    organisationId: string,
    dto: UpsertRecipientProfileDto,
  ): Promise<RecipientProfileResponseDto> {
    const existing = await this.profileRepo.findOne({
      where: { organisationId, isDeleted: false },
    });

    // Open fields normalised exactly as the donor's preferences are; closed
    // fields arrive validated against the vocabulary and are stored as sent.
    // levy-vocabulary.ts has the reason for the difference.
    if (existing) {
      existing.sector = normaliseOpenVocabularyValue(dto.sector);
      existing.region = dto.region;
      existing.employeeCountBand = dto.employeeCountBand;
      existing.programmeType = normaliseOpenVocabularyValue(dto.programmeType);
      existing.transferAmountRequired = dto.transferAmountRequired;
      existing.hasDasAccount = dto.hasDasAccount;
      // Optional on the DTO: an update that omits it must not silently
      // un-list a profile the SME deliberately opted in.
      if (dto.isListed !== undefined) {
        existing.isListed = dto.isListed;
      }
      return this.toResponse(await this.profileRepo.save(existing));
    }

    const created = this.profileRepo.create({
      organisationId,
      sector: normaliseOpenVocabularyValue(dto.sector),
      region: dto.region,
      employeeCountBand: dto.employeeCountBand,
      programmeType: normaliseOpenVocabularyValue(dto.programmeType),
      transferAmountRequired: dto.transferAmountRequired,
      hasDasAccount: dto.hasDasAccount,
      // Private unless explicitly opted in.
      isListed: dto.isListed ?? false,
    });
    return this.toResponse(await this.profileRepo.save(created));
  }

  /**
   * F1.1.4 AC2 — donor-facing SME directory.
   *
   * Only profiles that opted in via `isListed` are readable across tenants
   * (enforced by the `_select_listed` RLS policy, not just this WHERE clause —
   * the filter here is for correctness and index use, the policy is the actual
   * boundary). The caller's own organisation is excluded: an employer browsing
   * for recipients has no use for itself in the results.
   */
  async searchDirectory(
    viewerOrganisationId: string,
    query: SearchRecipientDirectoryDto,
  ): Promise<PaginatedResult<RecipientProfileResponseDto>> {
    const qb = this.profileRepo
      .createQueryBuilder('p')
      .where('p.isListed = true')
      .andWhere('p.isDeleted = false')
      .andWhere('p.organisationId != :viewerOrganisationId', {
        viewerOrganisationId,
      });

    /**
     * ── THE SAME COMPARISON AS MATCHING, AND IT MUST STAY THAT WAY ──────────
     *
     * These three filters used to read `LOWER(p.sector) = LOWER(:sector)`.
     * `LevyMatchingService.passesPreferenceFilters` compares the same fields
     * with `Array.includes`, which is exact, so the directory admitted rows
     * matching would then refuse: a donor found an SME by searching "retail",
     * asked for a match, and got nothing — and neither screen said why.
     *
     * Matching decides who gets money, so matching is the reference and this
     * is exact too. The two are only equivalent while both are exact: a
     * case-insensitive pair would need the same case fold in Postgres and in
     * JavaScript, and `LOWER()` follows the column's collation while
     * `String.prototype.toLowerCase` follows Unicode's own rules — agreeing on
     * ASCII and not guaranteed to agree beyond it. That is the same shape of
     * defect as the two vocabularies, one layer down.
     *
     * What keeps the two sides speaking one language is
     * GET /levy-exchange/vocabulary: both writes take their values from it,
     * closed fields can only hold a served value, and the open fields are
     * normalised identically on each write
     * (`normaliseOpenVocabularyValue`).
     *
     * Two gaps remain, and exactness makes them visible rather than creating
     * them. Case is still a near-miss on the open fields — "retail" is not
     * "Retail" — and it now fails here exactly as it already failed in
     * matching, instead of the directory hiding it. And the donor's directory
     * filters in apps/employer are still free-text boxes rather than the
     * served values, so a donor can still type a value no profile holds; that
     * screen should offer `open.sector` / `open.programmeType` as suggestions
     * and `closed.region` as a select, the way the preferences screen does.
     */
    if (query.sector) {
      qb.andWhere('p.sector = :sector', { sector: query.sector });
    }
    if (query.region) {
      qb.andWhere('p.region = :region', { region: query.region });
    }
    if (query.programmeType) {
      qb.andWhere('p.programmeType = :programmeType', {
        programmeType: query.programmeType,
      });
    }

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const [rows, total] = await qb
      .orderBy('p.updatedAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async get(organisationId: string): Promise<RecipientProfileResponseDto> {
    const profile = await this.profileRepo.findOne({
      where: { organisationId, isDeleted: false },
    });
    if (!profile) {
      throw new NotFoundException('Recipient profile not found');
    }
    return this.toResponse(profile);
  }

  async getEntityOrThrow(
    organisationId: string,
  ): Promise<LevyRecipientProfile> {
    const profile = await this.profileRepo.findOne({
      where: { organisationId, isDeleted: false },
    });
    if (!profile) {
      throw new NotFoundException('Recipient profile not found');
    }
    return profile;
  }

  private toResponse(
    profile: LevyRecipientProfile,
  ): RecipientProfileResponseDto {
    return {
      id: profile.id,
      organisationId: profile.organisationId,
      sector: profile.sector,
      region: profile.region,
      employeeCountBand: profile.employeeCountBand,
      programmeType: profile.programmeType,
      transferAmountRequired: profile.transferAmountRequired,
      hasDasAccount: profile.hasDasAccount,
      isListed: profile.isListed,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
