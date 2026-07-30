import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../../common/pagination/paginated-result.js';
import { RecipientProfileResponseDto } from '../dto/recipient-profile-response.dto.js';
import { SearchRecipientDirectoryDto } from '../dto/search-recipient-directory.dto.js';
import { UpsertRecipientProfileDto } from '../dto/upsert-recipient-profile.dto.js';
import { LevyRecipientProfile } from '../entities/levy-recipient-profile.entity.js';

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

    if (existing) {
      existing.sector = dto.sector.trim();
      existing.region = dto.region.trim();
      existing.employeeCountBand = dto.employeeCountBand.trim();
      existing.programmeType = dto.programmeType.trim();
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
      sector: dto.sector.trim(),
      region: dto.region.trim(),
      employeeCountBand: dto.employeeCountBand.trim(),
      programmeType: dto.programmeType.trim(),
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

    if (query.sector) {
      qb.andWhere('LOWER(p.sector) = LOWER(:sector)', { sector: query.sector });
    }
    if (query.region) {
      qb.andWhere('LOWER(p.region) = LOWER(:region)', { region: query.region });
    }
    if (query.programmeType) {
      qb.andWhere('LOWER(p.programmeType) = LOWER(:programmeType)', {
        programmeType: query.programmeType,
      });
    }

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const [rows, total] = await qb
      .orderBy('p.updatedAt', 'DESC')
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
