import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { StorageObjectCategory } from '../storage/enums/storage-object-category.enum.js';
import { StorageService } from '../storage/storage.service.js';

import { CreateKsEvidenceItemDto } from './dto/create-ks-evidence-item.dto.js';
import { CreateKsEvidenceUploadUrlDto } from './dto/create-ks-evidence-upload-url.dto.js';
import { KsEvidenceItemResponseDto } from './dto/ks-evidence-item-response.dto.js';
import { ListKsEvidenceItemsQueryDto } from './dto/list-ks-evidence-items-query.dto.js';
import { UpdateKsEvidenceItemDto } from './dto/update-ks-evidence-item.dto.js';
import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsEvidenceStatus } from './enums/ks-evidence-status.enum.js';
import { KsEvidenceType } from './enums/ks-evidence-type.enum.js';
import { KsEvidenceStatusService } from './ks-evidence-status.service.js';
import { KsEvidenceStorageService } from './ks-evidence-storage.service.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';
import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { PresignedUploadResponseDto } from '../storage/dto/create-presigned-upload.dto.js';

@Injectable()
export class KsEvidenceItemsService {
  constructor(
    @InjectRepository(KsEvidenceItem)
    private readonly itemRepo: Repository<KsEvidenceItem>,
    @InjectRepository(KsEvidenceKsbMapping)
    private readonly mappingRepo: Repository<KsEvidenceKsbMapping>,
    private readonly dataSource: DataSource,
    private readonly enrolmentContext: PortfolioEnrolmentContext,
    private readonly ksbDefinitionsService: KsbDefinitionsService,
    private readonly storageService: StorageService,
    private readonly evidenceStorage: KsEvidenceStorageService,
    private readonly statusService: KsEvidenceStatusService,
    private readonly notificationsService: NotificationsService,
    private readonly heatmapCache: PortfolioHeatmapCacheService,
    private readonly eifScoreCache: EifScoreCacheService,
  ) {}

  async createUploadUrl(
    user: AuthenticatedUser,
    dto: CreateKsEvidenceUploadUrlDto,
  ): Promise<PresignedUploadResponseDto> {
    return this.storageService.createUploadUrl(user.organisationId!, {
      filename: dto.filename,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
      category: StorageObjectCategory.EVIDENCE,
      learnerId: dto.apprenticeId,
    });
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateKsEvidenceItemDto,
  ): Promise<KsEvidenceItemResponseDto> {
    const organisationId = user.organisationId!;
    const enrolment = await this.enrolmentContext.requireEnrolment(
      organisationId,
      dto.enrolmentId,
      dto.apprenticeId,
    );
    this.validateTypePayload(dto.type, dto);

    if (dto.type === KsEvidenceType.FILE && dto.storageKey) {
      this.evidenceStorage.assertEvidenceStorageKey(
        organisationId,
        dto.apprenticeId,
        dto.storageKey,
      );
    }

    await this.ksbDefinitionsService.findEntitiesForStandard(
      organisationId,
      enrolment.standardId,
      dto.ksbDefinitionIds,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const item = manager.create(KsEvidenceItem, {
        organisationId,
        enrolmentId: dto.enrolmentId,
        apprenticeId: dto.apprenticeId,
        type: dto.type,
        title: dto.title,
        body: dto.body ?? null,
        storageKey: dto.type === KsEvidenceType.FILE ? dto.storageKey! : null,
        externalUrl: dto.type === KsEvidenceType.LINK ? dto.externalUrl! : null,
        status: KsEvidenceStatus.DRAFT,
      });
      const persisted = await manager.save(item);
      await manager.save(
        dto.ksbDefinitionIds.map((ksbDefinitionId) =>
          manager.create(KsEvidenceKsbMapping, {
            organisationId,
            evidenceItemId: persisted.id,
            ksbDefinitionId,
          }),
        ),
      );
      return persisted;
    });

    return this.toResponse(saved, dto.ksbDefinitionIds);
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListKsEvidenceItemsQueryDto,
  ): Promise<PaginatedResult<KsEvidenceItemResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const organisationId = user.organisationId!;

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .where('item.organisationId = :organisationId', { organisationId })
      .andWhere('item.isDeleted = false');

    if (query.status) {
      qb.andWhere('item.status = :status', { status: query.status });
    }
    if (query.enrolmentId) {
      qb.andWhere('item.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    }
    if (query.apprenticeId) {
      qb.andWhere('item.apprenticeId = :apprenticeId', {
        apprenticeId: query.apprenticeId,
      });
    }
    if (query.ksbDefinitionId) {
      qb.innerJoin(
        'ks_evidence_ksb_mappings',
        'map',
        'map.evidenceItemId = item.id AND map.ksbDefinitionId = :ksbDefinitionId',
        { ksbDefinitionId: query.ksbDefinitionId },
      );
    }

    qb.orderBy('item.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    const responses = await Promise.all(
      rows.map((row) => this.toResponseWithMappings(row)),
    );
    return new PaginatedResult(
      responses,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<KsEvidenceItemResponseDto> {
    const row = await this.findEntity(user, id);
    return this.toResponseWithMappings(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateKsEvidenceItemDto,
  ): Promise<KsEvidenceItemResponseDto> {
    const row = await this.findEntity(user, id);
    if (row.status !== KsEvidenceStatus.DRAFT) {
      throw new BadRequestException('Only draft evidence can be updated');
    }

    if (dto.title !== undefined) row.title = dto.title;
    if (dto.body !== undefined) row.body = dto.body;
    if (dto.storageKey !== undefined) {
      if (row.type !== KsEvidenceType.FILE) {
        throw new BadRequestException(
          'storageKey applies to file evidence only',
        );
      }
      this.evidenceStorage.assertEvidenceStorageKey(
        row.organisationId,
        row.apprenticeId,
        dto.storageKey,
      );
      row.storageKey = dto.storageKey;
    }
    if (dto.externalUrl !== undefined) {
      if (row.type !== KsEvidenceType.LINK) {
        throw new BadRequestException(
          'externalUrl applies to link evidence only',
        );
      }
      row.externalUrl = dto.externalUrl;
    }

    if (dto.ksbDefinitionIds !== undefined) {
      const enrolment = await this.enrolmentContext.requireEnrolment(
        row.organisationId,
        row.enrolmentId,
      );
      await this.ksbDefinitionsService.findEntitiesForStandard(
        row.organisationId,
        enrolment.standardId,
        dto.ksbDefinitionIds,
      );
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(KsEvidenceKsbMapping, {
          evidenceItemId: row.id,
        });
        await manager.save(
          dto.ksbDefinitionIds!.map((ksbDefinitionId) =>
            manager.create(KsEvidenceKsbMapping, {
              organisationId: row.organisationId,
              evidenceItemId: row.id,
              ksbDefinitionId,
            }),
          ),
        );
        await manager.save(row);
      });
      return this.toResponse(row, dto.ksbDefinitionIds);
    }

    await this.itemRepo.save(row);
    return this.toResponseWithMappings(row);
  }

  async submit(
    user: AuthenticatedUser,
    id: string,
  ): Promise<KsEvidenceItemResponseDto> {
    const row = await this.findEntity(user, id);
    this.statusService.applyTransition(row.status, KsEvidenceStatus.SUBMITTED);
    row.status = KsEvidenceStatus.SUBMITTED;
    row.submittedAt = new Date();
    row.submittedByUserId = user.id;
    row.returnedAt = null;
    row.returnedByUserId = null;
    row.returnReason = null;
    await this.itemRepo.save(row);
    await this.heatmapCache.invalidate(row.organisationId, row.enrolmentId);
    return this.toResponseWithMappings(row);
  }

  async review(
    user: AuthenticatedUser,
    id: string,
  ): Promise<KsEvidenceItemResponseDto> {
    this.assertTutorOrAdmin(user);
    const row = await this.findEntity(user, id);
    this.statusService.applyTransition(row.status, KsEvidenceStatus.REVIEWED);
    row.status = KsEvidenceStatus.REVIEWED;
    row.reviewedAt = new Date();
    row.reviewedByUserId = user.id;
    await this.itemRepo.save(row);
    await this.heatmapCache.invalidate(row.organisationId, row.enrolmentId);
    return this.toResponseWithMappings(row);
  }

  async accept(
    user: AuthenticatedUser,
    id: string,
  ): Promise<KsEvidenceItemResponseDto> {
    this.assertTutorOrAdmin(user);
    const row = await this.findEntity(user, id);
    this.statusService.applyTransition(row.status, KsEvidenceStatus.ACCEPTED);
    row.status = KsEvidenceStatus.ACCEPTED;
    row.acceptedAt = new Date();
    row.acceptedByUserId = user.id;
    await this.itemRepo.save(row);
    await this.heatmapCache.invalidate(row.organisationId, row.enrolmentId);
    await this.eifScoreCache.invalidate(row.organisationId);
    await this.notificationsService.createForUser({
      userId: row.submittedByUserId ?? user.id,
      organisationId: row.organisationId,
      type: NotificationType.PORTFOLIO,
      title: 'Evidence accepted',
      body: `Evidence "${row.title}" has been accepted.`,
      metadata: { evidenceItemId: row.id, status: KsEvidenceStatus.ACCEPTED },
    });
    return this.toResponseWithMappings(row);
  }

  async returnToDraft(
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<KsEvidenceItemResponseDto> {
    this.assertTutorOrAdmin(user);
    const row = await this.findEntity(user, id);
    if (!this.statusService.canReturnToDraft(row.status)) {
      throw new BadRequestException(
        'Evidence can only be returned from submitted or reviewed status',
      );
    }
    row.status = KsEvidenceStatus.DRAFT;
    row.returnedAt = new Date();
    row.returnedByUserId = user.id;
    row.returnReason = reason;
    row.submittedAt = null;
    row.submittedByUserId = null;
    row.reviewedAt = null;
    row.reviewedByUserId = null;
    row.acceptedAt = null;
    row.acceptedByUserId = null;
    await this.itemRepo.save(row);
    await this.heatmapCache.invalidate(row.organisationId, row.enrolmentId);
    return this.toResponseWithMappings(row);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.findEntity(user, id);
    if (row.status !== KsEvidenceStatus.DRAFT) {
      throw new BadRequestException('Only draft evidence can be deleted');
    }
    row.isDeleted = true;
    row.deletedAt = new Date();
    await this.itemRepo.save(row);
  }

  private validateTypePayload(
    type: KsEvidenceType,
    dto: Pick<CreateKsEvidenceItemDto, 'storageKey' | 'externalUrl' | 'body'>,
  ): void {
    switch (type) {
      case KsEvidenceType.FILE:
        if (!dto.storageKey) {
          throw new BadRequestException(
            'storageKey is required for file evidence',
          );
        }
        if (dto.externalUrl) {
          throw new BadRequestException(
            'externalUrl is not allowed for file evidence',
          );
        }
        break;
      case KsEvidenceType.LINK:
        if (!dto.externalUrl) {
          throw new BadRequestException(
            'externalUrl is required for link evidence',
          );
        }
        if (dto.storageKey) {
          throw new BadRequestException(
            'storageKey is not allowed for link evidence',
          );
        }
        break;
      case KsEvidenceType.TEXT:
        if (!dto.body?.trim()) {
          throw new BadRequestException('body is required for text evidence');
        }
        if (dto.storageKey || dto.externalUrl) {
          throw new BadRequestException(
            'storageKey and externalUrl are not allowed for text evidence',
          );
        }
        break;
    }
  }

  private assertTutorOrAdmin(user: AuthenticatedUser): void {
    const roles = user.roles ?? [];
    if (
      !roles.includes(OrganisationRole.OWNER) &&
      !roles.includes(OrganisationRole.ADMIN)
    ) {
      throw new ForbiddenException(
        'Only organisation admins can perform this action',
      );
    }
  }

  async findEntity(
    user: AuthenticatedUser,
    id: string,
  ): Promise<KsEvidenceItem> {
    const row = await this.itemRepo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('KSB evidence item not found');
    return row;
  }

  private async toResponseWithMappings(
    row: KsEvidenceItem,
  ): Promise<KsEvidenceItemResponseDto> {
    const mappings = await this.mappingRepo.find({
      where: { evidenceItemId: row.id },
    });
    const ksbIds = mappings.map((m) => m.ksbDefinitionId);
    return this.toResponse(row, ksbIds);
  }

  private async toResponse(
    row: KsEvidenceItem,
    ksbDefinitionIds: string[],
  ): Promise<KsEvidenceItemResponseDto> {
    const ksbDefinitions = await this.ksbDefinitionsService.findResponsesByIds(
      row.organisationId,
      ksbDefinitionIds,
    );
    return {
      id: row.id,
      organisationId: row.organisationId,
      enrolmentId: row.enrolmentId,
      apprenticeId: row.apprenticeId,
      type: row.type,
      title: row.title,
      body: row.body,
      storageKey: row.storageKey,
      externalUrl: row.externalUrl,
      status: row.status,
      ksbDefinitions,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      returnReason: row.returnReason,
    };
  }
}
