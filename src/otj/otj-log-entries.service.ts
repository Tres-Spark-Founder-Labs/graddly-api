import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { StorageObjectCategory } from '../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

import { BulkOtjActionResponseDto } from './dto/bulk-otj-action-response.dto.js';
import { CreateOtjLogEntryDto } from './dto/create-otj-log-entry.dto.js';
import { ListOtjLogEntriesQueryDto } from './dto/list-otj-log-entries-query.dto.js';
import { OtjLogEntryResponseDto } from './dto/otj-log-entry-response.dto.js';
import { UpdateOtjLogEntryDto } from './dto/update-otj-log-entry.dto.js';
import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class OtjLogEntriesService {
  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly repo: Repository<OtjLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
    private readonly eifScoreCache: EifScoreCacheService,
    private readonly keyBuilder: StorageKeyBuilder,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    const organisationId = user.organisationId!;
    await this.assertEnrolmentMatch(
      organisationId,
      dto.enrolmentId,
      dto.apprenticeId,
    );
    this.assertEvidence(organisationId, dto.apprenticeId, dto.evidence);

    const entity = this.repo.create({
      organisationId,
      enrolmentId: dto.enrolmentId,
      apprenticeId: dto.apprenticeId,
      loggedDate: dto.loggedDate,
      minutes: dto.minutes,
      activityName: dto.activityName,
      category: dto.category,
      note: dto.note ?? null,
      evidence: dto.evidence ?? null,
      status: OtjLogStatus.DRAFT,
    });
    return this.toResponse(await this.repo.save(entity));
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListOtjLogEntriesQueryDto,
  ): Promise<PaginatedResult<OtjLogEntryResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const qb = this.repo
      .createQueryBuilder('otj')
      .where('otj.organisationId = :organisationId', {
        organisationId: user.organisationId!,
      })
      .andWhere('otj.isDeleted = false');

    if (query.status)
      qb.andWhere('otj.status = :status', { status: query.status });
    if (query.apprenticeId)
      qb.andWhere('otj.apprenticeId = :apprenticeId', {
        apprenticeId: query.apprenticeId,
      });
    if (query.enrolmentId)
      qb.andWhere('otj.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    if (query.category)
      qb.andWhere('otj.category = :category', { category: query.category });
    if (query.from)
      qb.andWhere('otj.loggedDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('otj.loggedDate <= :to', { to: query.to });

    qb.orderBy('otj.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);
    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<OtjLogEntryResponseDto> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('OTJ log entry not found');
    return this.toResponse(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('OTJ log entry not found');

    const organisationId = user.organisationId!;
    const enrolmentId = dto.enrolmentId ?? row.enrolmentId;
    const apprenticeId = dto.apprenticeId ?? row.apprenticeId;
    if (dto.enrolmentId !== undefined || dto.apprenticeId !== undefined) {
      await this.assertEnrolmentMatch(
        organisationId,
        enrolmentId,
        apprenticeId,
      );
    }
    if (dto.evidence !== undefined) {
      this.assertEvidence(organisationId, apprenticeId, dto.evidence);
    }

    if (dto.status !== undefined) {
      this.applyStatusTransition(row, dto.status);
    }

    if (dto.enrolmentId !== undefined) row.enrolmentId = dto.enrolmentId;
    if (dto.apprenticeId !== undefined) row.apprenticeId = dto.apprenticeId;
    if (dto.loggedDate !== undefined) row.loggedDate = dto.loggedDate;
    if (dto.minutes !== undefined) row.minutes = dto.minutes;
    if (dto.activityName !== undefined) row.activityName = dto.activityName;
    if (dto.category !== undefined) row.category = dto.category;
    if (dto.note !== undefined) row.note = dto.note;
    if (dto.evidence !== undefined) row.evidence = dto.evidence;

    return this.toResponse(await this.repo.save(row));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.repo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
    });
    if (!row) throw new NotFoundException('OTJ log entry not found');
    await this.repo.softRemove(row);
  }

  async bulkApprove(
    user: AuthenticatedUser,
    ids: string[],
  ): Promise<BulkOtjActionResponseDto> {
    return this.bulkTransition(user, ids, OtjLogStatus.APPROVED);
  }

  async bulkReject(
    user: AuthenticatedUser,
    ids: string[],
    reason?: string,
  ): Promise<BulkOtjActionResponseDto> {
    return this.bulkTransition(user, ids, OtjLogStatus.REJECTED, reason);
  }

  private async bulkTransition(
    user: AuthenticatedUser,
    ids: string[],
    target: OtjLogStatus.APPROVED | OtjLogStatus.REJECTED,
    reason?: string,
  ): Promise<BulkOtjActionResponseDto> {
    const results: BulkOtjActionResponseDto['results'] = [];
    for (const id of ids) {
      let notificationQueued = false;
      try {
        const row = await this.repo.findOne({
          where: { id, organisationId: user.organisationId!, isDeleted: false },
        });
        if (!row) {
          results.push({
            id,
            ok: false,
            reasonCode: 'not_found',
            message: 'OTJ log entry not found',
            notificationQueued,
          });
          continue;
        }
        if (row.status !== OtjLogStatus.SUBMITTED && row.status !== target) {
          throw new BadRequestException('invalid_transition');
        }
        if (target === OtjLogStatus.APPROVED) {
          row.status = OtjLogStatus.APPROVED;
          row.approvedAt = new Date();
          row.approvedByUserId = user.id;
          row.rejectedAt = null;
          row.rejectedByUserId = null;
          row.rejectionReason = null;
        } else {
          row.status = OtjLogStatus.REJECTED;
          row.rejectedAt = new Date();
          row.rejectedByUserId = user.id;
          row.rejectionReason = reason ?? null;
        }
        await this.repo.save(row);
        try {
          await this.notificationsService.createForUser({
            userId: user.id,
            organisationId: user.organisationId,
            type: NotificationType.OTJ,
            title: `OTJ entry ${target}`,
            body: `OTJ entry ${row.id} was ${target}.`,
            metadata: { otjLogEntryId: row.id, status: target },
          });
          if (user.email) {
            await this.emailDispatchService.enqueue(
              new SerializedEmailPayload(
                EmailTemplate.EMAIL_VERIFICATION,
                user.email,
                {
                  firstName: user.firstName ?? 'there',
                  verifyUrl:
                    this.config.get<string>('app.frontend.baseUrl', '') || '#',
                  expiryHours: 24,
                },
              ),
            );
          }
          notificationQueued = true;
        } catch {
          notificationQueued = false;
        }
        results.push({
          id,
          ok: true,
          reasonCode: null,
          message: null,
          notificationQueued,
        });
      } catch (error) {
        const reasonCode =
          error instanceof BadRequestException
            ? 'invalid_transition'
            : 'internal_error';
        results.push({
          id,
          ok: false,
          reasonCode,
          message: error instanceof Error ? error.message : String(error),
          notificationQueued,
        });
      }
    }

    if (
      results.some((r) => r.ok) &&
      user.organisationId &&
      (target === OtjLogStatus.APPROVED || target === OtjLogStatus.REJECTED)
    ) {
      await this.eifScoreCache.invalidate(user.organisationId);
    }

    return {
      processed: results.length,
      succeeded: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    };
  }

  private applyStatusTransition(row: OtjLogEntry, target: OtjLogStatus): void {
    if (row.status === target) {
      return;
    }
    if (
      target === OtjLogStatus.SUBMITTED &&
      row.status === OtjLogStatus.DRAFT
    ) {
      row.status = OtjLogStatus.SUBMITTED;
      return;
    }
    throw new BadRequestException(
      `Cannot transition OTJ log entry from ${row.status} to ${target}`,
    );
  }

  private async assertEnrolmentMatch(
    organisationId: string,
    enrolmentId: string,
    apprenticeId: string,
  ): Promise<void> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new BadRequestException('Enrolment not found in organisation');
    }
    if (enrolment.apprenticeId !== apprenticeId) {
      throw new BadRequestException('Apprentice does not match enrolment');
    }
  }

  private assertEvidence(
    organisationId: string,
    apprenticeId: string,
    evidence: Record<string, unknown> | null | undefined,
  ): void {
    if (!evidence) return;

    const files = evidence.files;
    if (files === undefined) return;
    if (!Array.isArray(files)) {
      throw new BadRequestException(
        'evidence.files must be an array of storage keys',
      );
    }

    const expectedPrefix = `orgs/${organisationId}/learners/${apprenticeId}/${StorageObjectCategory.EVIDENCE}/`;
    for (const key of files) {
      if (typeof key !== 'string') {
        throw new BadRequestException(
          'evidence.files must contain storage key strings',
        );
      }
      if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
        throw new BadRequestException(`Invalid storage key: ${key}`);
      }
      if (!key.startsWith(expectedPrefix)) {
        throw new BadRequestException(
          'Storage key must be an evidence object for this apprentice',
        );
      }
    }
  }

  private toResponse(entity: OtjLogEntry): OtjLogEntryResponseDto {
    return {
      id: entity.id,
      organisationId: entity.organisationId,
      enrolmentId: entity.enrolmentId,
      apprenticeId: entity.apprenticeId,
      loggedDate: entity.loggedDate,
      minutes: entity.minutes,
      activityName: entity.activityName,
      category: entity.category,
      note: entity.note,
      evidence: entity.evidence,
      status: entity.status,
      paceFlag: entity.paceFlag,
      rejectionReason: entity.rejectionReason,
    };
  }
}
