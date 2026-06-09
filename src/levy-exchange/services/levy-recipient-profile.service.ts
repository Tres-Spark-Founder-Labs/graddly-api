import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RecipientProfileResponseDto } from '../dto/recipient-profile-response.dto.js';
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
    });
    return this.toResponse(await this.profileRepo.save(created));
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
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
