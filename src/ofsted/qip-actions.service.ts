import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfJobResponseDto } from '../pdf/dto/pdf-job-response.dto.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { User } from '../users/entities/user.entity.js';

import { CreateQipActionDto } from './dto/create-qip-action.dto.js';
import { ListQipActionsQueryDto } from './dto/list-qip-actions-query.dto.js';
import { QipActionResponseDto } from './dto/qip-action-response.dto.js';
import { QipActionsSummaryDto } from './dto/qip-actions-summary.dto.js';
import { UpdateQipActionProgressDto } from './dto/update-qip-action-progress.dto.js';
import { UpdateQipActionDto } from './dto/update-qip-action.dto.js';
import {
  getEifCriterionSlugs,
  loadEifCriteriaConfig,
} from './eif-criteria.config.js';
import { EifScoreCacheService } from './eif-score-cache.service.js';
import { QipAction } from './entities/qip-action.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IQipPlanContent } from '../pdf/interfaces/pdf-renderer.interface.js';

/** Plain-English status wording for the exported plan. */
const QIP_STATUS_LABELS: Record<QipActionStatus, string> = {
  [QipActionStatus.NOT_STARTED]: 'Not started',
  [QipActionStatus.IN_PROGRESS]: 'In progress',
  [QipActionStatus.COMPLETED]: 'Completed',
};

@Injectable()
export class QipActionsService {
  constructor(
    @InjectRepository(QipAction)
    private readonly repo: Repository<QipAction>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly eifScoreCache: EifScoreCacheService,
    private readonly pdfDispatch: PdfDispatchService,
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

  /**
   * F2.1.2 — records progress without touching the plan.
   *
   * Delegates to `update` rather than duplicating its validation and cache
   * invalidation; the narrowing is the DTO's job, not a second write path.
   * Two implementations of "save a QIP action" would eventually disagree
   * about something, and the one nobody looks at would be the one that
   * skipped invalidating the EIF score.
   */
  async updateProgress(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateQipActionProgressDto,
  ): Promise<QipActionResponseDto> {
    return this.update(user, id, dto);
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

  /** F2.1.2 AC5 — queue the plan as a PDF. */
  async exportPdf(user: AuthenticatedUser): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    const job = await this.pdfDispatch.enqueue({
      organisationId,
      userId: user.id,
      template: PdfJobTemplate.QIP_PLAN,
    });

    return {
      jobId: job.id,
      status: job.status,
      template: job.template,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Builds the plan document.
   *
   * Grouped by EIF criterion in catalogue order, because that is the unit an
   * inspector works in — and because it makes an empty criterion visible.
   * A plan with nothing against "safeguarding" is itself a finding, which a
   * flat list of whatever happens to exist would hide.
   */
  async buildPlanContent(
    organisationId: string,
    requestedByUserId: string,
  ): Promise<IQipPlanContent> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const [rows, organisation, requester] = await Promise.all([
        this.repo.find({
          where: { organisationId, isDeleted: false },
          order: { targetCompletionDate: 'ASC' },
        }),
        this.organisationRepo.findOne({ where: { id: organisationId } }),
        this.userRepo.findOne({ where: { id: requestedByUserId } }),
      ]);

      const ownerIds = [...new Set(rows.map((r) => r.assignedOwnerUserId))];
      const owners = ownerIds.length
        ? await this.userRepo.findBy({ id: In(ownerIds) })
        : [];
      const ownerNames = new Map(
        owners.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
      );

      const completed = rows.filter(
        (r) => r.status === QipActionStatus.COMPLETED,
      ).length;
      const overdue = rows.filter((r) => this.isOverdue(r)).length;

      const catalogue = loadEifCriteriaConfig().criteria;
      const groups = catalogue
        .map((definition) => ({
          slug: definition.slug,
          label: definition.label,
          actions: rows
            .filter((r) => r.eifCriterionSlug === definition.slug)
            .map((r) => ({
              title: r.title,
              description: r.description,
              // Named, not a UUID: "assigned owner (staff member)" is the
              // point of AC1, and an inspector cannot chase an identifier.
              ownerName: ownerNames.get(r.assignedOwnerUserId) ?? 'Unassigned',
              targetCompletionDate: r.targetCompletionDate,
              status: QIP_STATUS_LABELS[r.status] ?? r.status,
              isOverdue: this.isOverdue(r),
              evidenceNotes: r.evidenceNotes,
              evidenceAttachmentCount: r.evidenceAttachmentKeys?.length ?? 0,
            })),
        }))
        .filter((group) => group.actions.length > 0);

      return {
        organisationName: organisation?.name ?? 'Organisation',
        total: rows.length,
        completed,
        overdue,
        percentComplete:
          rows.length === 0 ? 0 : Math.round((completed / rows.length) * 100),
        groups,
        generatedAt: new Date().toISOString(),
        generatedByName: requester
          ? `${requester.firstName} ${requester.lastName}`.trim()
          : 'Not recorded',
      };
    } finally {
      setRlsBootstrap(previousBootstrap);
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
