import {
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { auditEntriesToCsv } from './audit-csv.util.js';
import {
  AuditCompleteExportDto,
  AuditCompleteExportQueryDto,
  AuditExportQueryDto,
  AuditLogEntryDto,
} from './dto/audit-export-query.dto.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditExportFormat } from './enums/audit-export-format.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';

export type AuditExportJsonResult = PaginatedResult<AuditLogEntryDto>;

export type AuditExportCsvResult = {
  csv: string;
  meta: IPaginationMeta;
};

export type AuditExportResult = AuditExportJsonResult | AuditExportCsvResult;

@Injectable()
export class AuditExportService {
  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly auditRepo: Repository<AuditLogEntry>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Every audit entry in scope, as one file — or an error, never part of one.
   *
   * ── WHY SERVER-SIDE, IN ONE READ ────────────────────────────────────────────
   *
   * The provider's export used to call the paginated endpoint with no page
   * parameters, got the default twenty rows, and saved them as "the audit
   * log". Paging through on the client (as the employer roster now does)
   * would fix the count but not the shape of the risk: a few hundred requests
   * against a 100-a-minute throttle for a large range, each a separate
   * snapshot, and a client that must stitch them together correctly for the
   * file to be complete. Here the rows are read in one statement — one
   * snapshot, so `total` is exactly the rows returned — and the response is
   * either the whole export or an HTTP error.
   *
   * It is not streamed. A streamed response commits to 200 on its first
   * byte, so a failure half-way arrives as a short file with a success code:
   * the one outcome an audit export must not have. The size is bounded
   * instead, by AUDIT_EXPORT_MAX_ROWS.
   *
   * ── TOO LARGE FAILS LOUDLY ──────────────────────────────────────────────────
   *
   * Above the limit the request is refused with 413 and the count, so the
   * screen can say "narrow the range" rather than hand over the first fifty
   * thousand. The count is checked before the read and again on it (the read
   * takes one more row than the limit), so rows written in between cannot
   * slip a file over the limit either.
   */
  async exportAll(
    user: AuthenticatedUser,
    query: AuditCompleteExportQueryDto,
  ): Promise<AuditCompleteExportDto> {
    const organisationId = user.organisationId;
    if (!organisationId) {
      throw new ForbiddenException('No active organisation context');
    }
    const limit = this.config.get<number>('app.audit.exportMaxRows', 50000);

    const inScope = this.scoped(organisationId, query);
    const counted = await inScope.clone().getCount();
    if (counted > limit) {
      throw this.tooLarge(counted, limit);
    }

    const rows = await inScope
      .clone()
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .take(limit + 1)
      .getMany();
    if (rows.length > limit) {
      throw this.tooLarge(rows.length, limit);
    }

    return {
      organisationId,
      exportedAt: new Date().toISOString(),
      filters: {
        from: query.from ?? null,
        to: query.to ?? null,
        entityType: query.entityType ?? null,
        action: query.action ?? null,
      },
      total: rows.length,
      entries: rows.map((row) => this.toDto(row)),
    };
  }

  /** CSV for the complete export: the entries, as the paginated CSV writes them. */
  completeExportToCsv(result: AuditCompleteExportDto): string {
    return auditEntriesToCsv(result.entries);
  }

  private scoped(
    organisationId: string,
    query: Pick<
      AuditCompleteExportQueryDto,
      'entityType' | 'action' | 'from' | 'to'
    >,
  ): SelectQueryBuilder<AuditLogEntry> {
    const qb = this.auditRepo
      .createQueryBuilder('audit')
      .where('audit.organisationId = :organisationId', { organisationId });
    if (query.entityType) {
      qb.andWhere('audit.entityType = :entityType', {
        entityType: query.entityType,
      });
    }
    if (query.action) {
      qb.andWhere('audit.action = :action', { action: query.action });
    }
    if (query.from) {
      qb.andWhere('audit.createdAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('audit.createdAt <= :to', { to: query.to });
    }
    return qb;
  }

  private tooLarge(count: number, limit: number): PayloadTooLargeException {
    return new PayloadTooLargeException(
      `This export would contain ${count.toLocaleString('en-GB')} audit entries, ` +
        `more than the ${limit.toLocaleString('en-GB')} one file can hold. ` +
        'Choose a narrower date range and export it in parts. No file was produced.',
    );
  }

  async export(
    user: AuthenticatedUser,
    query: AuditExportQueryDto,
  ): Promise<AuditExportResult> {
    const organisationId = user.organisationId;
    if (!organisationId) {
      throw new ForbiddenException('No active organisation context');
    }

    const page = query.page;
    const perPage = query.perPage;
    const skip = (page - 1) * perPage;

    const qb = this.auditRepo
      .createQueryBuilder('audit')
      .where('audit.organisationId = :organisationId', { organisationId })
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      .skip(skip)
      .take(perPage);

    if (query.entityType) {
      qb.andWhere('audit.entityType = :entityType', {
        entityType: query.entityType,
      });
    }

    if (query.action) {
      qb.andWhere('audit.action = :action', { action: query.action });
    }

    if (query.from) {
      qb.andWhere('audit.createdAt >= :from', { from: query.from });
    }

    if (query.to) {
      qb.andWhere('audit.createdAt <= :to', { to: query.to });
    }

    const [rows, total] = await qb.getManyAndCount();
    const items = rows.map((row) => this.toDto(row));
    const meta = buildPaginationMeta({ total, page, perPage });

    if (query.format === AuditExportFormat.CSV) {
      return {
        csv: auditEntriesToCsv(items),
        meta,
      };
    }

    return new PaginatedResult(items, meta);
  }

  private toDto(row: AuditLogEntry): AuditLogEntryDto {
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actorUserId: row.actorUserId,
      organisationId: row.organisationId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      changes: row.changes,
    };
  }
}
