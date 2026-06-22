import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DEFAULT_SAFEGUARDING_CHECKLIST_ITEMS } from './constants/default-safeguarding-checklist.js';
import { PatchSafeguardingChecklistItemDto } from './dto/patch-safeguarding-checklist-item.dto.js';
import { SafeguardingChecklistItemResponseDto } from './dto/safeguarding-checklist-item-response.dto.js';
import { EifScoreCacheService } from './eif-score-cache.service.js';
import { SafeguardingChecklistItem } from './entities/safeguarding-checklist-item.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class SafeguardingChecklistService {
  constructor(
    @InjectRepository(SafeguardingChecklistItem)
    private readonly repo: Repository<SafeguardingChecklistItem>,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async list(
    user: AuthenticatedUser,
  ): Promise<SafeguardingChecklistItemResponseDto[]> {
    const organisationId = user.organisationId!;
    await this.ensureDefaultItems(organisationId);
    const items = await this.repo.find({
      where: { organisationId, isDeleted: false },
      order: { slug: 'ASC' },
    });
    return items.map((item) => this.toResponse(item));
  }

  async markComplete(
    user: AuthenticatedUser,
    slug: string,
    dto: PatchSafeguardingChecklistItemDto,
  ): Promise<SafeguardingChecklistItemResponseDto> {
    const organisationId = user.organisationId!;
    await this.ensureDefaultItems(organisationId);

    const item = await this.repo.findOne({
      where: { organisationId, slug, isDeleted: false },
    });
    if (!item) {
      throw new NotFoundException(
        `Safeguarding checklist item not found: ${slug}`,
      );
    }

    item.completedAt = new Date();
    if (dto.evidenceStorageKey !== undefined) {
      item.evidenceStorageKey = dto.evidenceStorageKey ?? null;
    }

    const saved = await this.repo.save(item);
    await this.eifScoreCache.invalidate(organisationId);
    return this.toResponse(saved);
  }

  async completionPercent(organisationId: string): Promise<number> {
    await this.ensureDefaultItems(organisationId);
    const items = await this.repo.find({
      where: { organisationId, isDeleted: false },
    });
    if (items.length === 0) {
      return 0;
    }
    const completed = items.filter((item) => item.completedAt !== null).length;
    return Math.round((completed / items.length) * 100);
  }

  private async ensureDefaultItems(organisationId: string): Promise<void> {
    const existing = await this.repo.count({
      where: { organisationId, isDeleted: false },
    });
    if (existing > 0) {
      return;
    }

    const entities = DEFAULT_SAFEGUARDING_CHECKLIST_ITEMS.map((def) =>
      this.repo.create({
        organisationId,
        slug: def.slug,
        label: def.label,
        completedAt: null,
        evidenceStorageKey: null,
      }),
    );
    await this.repo.save(entities);
  }

  private toResponse(
    item: SafeguardingChecklistItem,
  ): SafeguardingChecklistItemResponseDto {
    return {
      slug: item.slug,
      label: item.label,
      completed: item.completedAt !== null,
      completedAt: item.completedAt?.toISOString() ?? null,
      evidenceStorageKey: item.evidenceStorageKey,
    };
  }
}
