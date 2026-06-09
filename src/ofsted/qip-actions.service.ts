import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

import { CreateQipActionDto } from './dto/create-qip-action.dto.js';
import { ListQipActionsQueryDto } from './dto/list-qip-actions-query.dto.js';
import { QipActionResponseDto } from './dto/qip-action-response.dto.js';
import { QipActionsSummaryDto } from './dto/qip-actions-summary.dto.js';
import { UpdateQipActionDto } from './dto/update-qip-action.dto.js';
import { getEifCriterionSlugs } from './eif-criteria.config.js';
import { EifScoreCacheService } from './eif-score-cache.service.js';
import { QipAction } from './entities/qip-action.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class QipActionsService {
  constructor(
    @InjectRepository(QipAction)
    private readonly repo: Repository<QipAction>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateQipActionDto,
  ): Promise<QipActionResponseDto> {
    const organisationId = user.organisationId!;
    this.assertCriterionSlug(dto.eifCriterionSlug);
    await this.assertOwnerInOrg(organisationId, dto.assignedOwnerUserId);
    this.assertAttachmentKeys(organisationId, dto.evidenceAttachmentKeys);

    const entity = this.repo.create({
      organisationId,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      assignedOwnerUserId: dto.assignedOwnerUserId,
      targetCompletionDate: dto.targetCompletionDate,
      eifCriterionSlug: dto.eifCriterionSlug,
      evidenceNotes: dto.evidenceNotes ?? null,
      evidenceAttachmentKeys: dto.evidenceAttachmentKeys ?? null,
      status: dto.status ?? QipActionStatus.NOT_STARTED,
    });
    await this.eifScoreCache.invalidate(organisationId);
    return this.toResponse(await this.repo.save(entity));
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListQipActionsQueryDto,
  ): Promise<PaginatedResult<QipActionResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const qb = this.repo
      .createQueryBuilder('qip')
      .where('qip.organisationId = :organisationId', {
        organisationId: user.organisationId!,
      })
      .andWhere('qip.isDeleted = false');

    if (query.status) {
      qb.andWhere('qip.status = :status', { status: query.status });
    }
    if (query.eifCriterionSlug) {
      qb.andWhere('qip.eifCriterionSlug = :slug', {
        slug: query.eifCriterionSlug,
      });
    }
    if (query.overdue === true) {
      qb.andWhere('qip.status != :completed', {
        completed: QipActionStatus.COMPLETED,
      }).andWhere('qip.targetCompletionDate < CURRENT_DATE');
    }

    qb.orderBy(
      `CASE WHEN qip.status != '${QipActionStatus.COMPLETED}' AND qip.targetCompletionDate < CURRENT_DATE THEN 0 ELSE 1 END`,
      'ASC',
    )
      .addOrderBy('qip.targetCompletionDate', 'ASC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async getSummary(user: AuthenticatedUser): Promise<QipActionsSummaryDto> {
    const organisationId = user.organisationId!;
    const rows = await this.repo.find({
      where: { organisationId, isDeleted: false },
    });
    const total = rows.length;
    const completed = rows.filter(
      (r) => r.status === QipActionStatus.COMPLETED,
    ).length;
    const overdue = rows.filter((r) => this.isOverdue(r)).length;
    const percentComplete =
      total === 0 ? 0 : Math.round((completed / total) * 100);
    return { total, completed, overdue, percentComplete };
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<QipActionResponseDto> {
    const row = await this.findEntity(user, id);
    return this.toResponse(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateQipActionDto,
  ): Promise<QipActionResponseDto> {
    const row = await this.findEntity(user, id);
    if (dto.eifCriterionSlug !== undefined) {
      this.assertCriterionSlug(dto.eifCriterionSlug);
      row.eifCriterionSlug = dto.eifCriterionSlug;
    }
    if (dto.assignedOwnerUserId !== undefined) {
      await this.assertOwnerInOrg(
        user.organisationId!,
        dto.assignedOwnerUserId,
      );
      row.assignedOwnerUserId = dto.assignedOwnerUserId;
    }
    if (dto.title !== undefined) row.title = dto.title.trim();
    if (dto.description !== undefined) {
      row.description = dto.description?.trim() ?? null;
    }
    if (dto.targetCompletionDate !== undefined) {
      row.targetCompletionDate = dto.targetCompletionDate;
    }
    if (dto.evidenceNotes !== undefined) {
      row.evidenceNotes = dto.evidenceNotes ?? null;
    }
    if (dto.evidenceAttachmentKeys !== undefined) {
      this.assertAttachmentKeys(
        user.organisationId!,
        dto.evidenceAttachmentKeys,
      );
      row.evidenceAttachmentKeys = dto.evidenceAttachmentKeys ?? null;
    }
    if (dto.status !== undefined) row.status = dto.status;

    await this.eifScoreCache.invalidate(user.organisationId!);
    return this.toResponse(await this.repo.save(row));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.findEntity(user, id);
    await this.repo.softRemove(row);
    await this.eifScoreCache.invalidate(user.organisationId!);
  }

  private async findEntity(
    user: AuthenticatedUser,
    id: string,
  ): Promise<QipAction> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('QIP action not found');
    return row;
  }

  private assertCriterionSlug(slug: string): void {
    if (!getEifCriterionSlugs().includes(slug)) {
      throw new BadRequestException('Invalid EIF criterion slug');
    }
  }

  private async assertOwnerInOrg(
    organisationId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.membershipRepo.findOne({
      where: {
        user: { id: userId },
        organisation: { id: organisationId },
        isDeleted: false,
      },
    });
    if (!membership) {
      throw new BadRequestException(
        'Assigned owner must be a member of the organisation',
      );
    }
  }

  private assertAttachmentKeys(
    organisationId: string,
    keys: string[] | undefined,
  ): void {
    if (!keys?.length) return;
    for (const key of keys) {
      if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
        throw new BadRequestException(`Invalid storage key: ${key}`);
      }
    }
  }

  private isOverdue(row: QipAction): boolean {
    if (row.status === QipActionStatus.COMPLETED) return false;
    const today = new Date().toISOString().slice(0, 10);
    return row.targetCompletionDate < today;
  }

  private toResponse(entity: QipAction): QipActionResponseDto {
    return {
      id: entity.id,
      organisationId: entity.organisationId,
      title: entity.title,
      description: entity.description,
      assignedOwnerUserId: entity.assignedOwnerUserId,
      targetCompletionDate: entity.targetCompletionDate,
      eifCriterionSlug: entity.eifCriterionSlug,
      evidenceNotes: entity.evidenceNotes,
      evidenceAttachmentKeys: entity.evidenceAttachmentKeys,
      status: entity.status,
      isOverdue: this.isOverdue(entity),
    };
  }
}
