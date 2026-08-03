import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';

import {
  getCurrentOrganisationId,
  getCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';

import {
  scrubDasActivitySummary,
  scrubDasActivityUrl,
  truncateDasActivityError,
} from './das-activity-scrub.util.js';
import { ListDasActivityQueryDto } from './dto/list-das-activity-query.dto.js';
import { DasApiActivity } from './entities/das-api-activity.entity.js';
import { DasApiOperation } from './enums/das-api-operation.enum.js';

import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

export interface IRecordDasActivityInput {
  operation: DasApiOperation;
  method: string;
  url: string;
  responseStatus: number | null;
  succeeded: boolean;
  durationMs: number;
  errorMessage?: string | null;
  requestSummary?: unknown;
  /** Overrides the ambient context, for callers outside a request (cron). */
  organisationId?: string;
}

@Injectable()
export class DasApiActivityService {
  private readonly logger = new Logger(DasApiActivityService.name);

  constructor(
    @InjectRepository(DasApiActivity)
    private readonly repo: Repository<DasApiActivity>,
  ) {}

  /**
   * F2.3.1 AC7 — record one call to the ESFA.
   *
   * Never throws. This is the single most important property of this method:
   * it is called from inside the HTTP client's error path, and an activity
   * log that can fail a DAS submission by failing to record it has made the
   * platform less reliable than having no log at all. A write failure is
   * logged and swallowed.
   */
  async record(input: IRecordDasActivityInput): Promise<void> {
    const organisationId = input.organisationId ?? getCurrentOrganisationId();
    if (!organisationId) {
      // A call made with no organisation in context cannot be filed against
      // one, and a row with a guessed owner is worse than a missing row in a
      // table that RLS partitions by organisation.
      this.logger.warn(
        `DAS ${input.operation} call not recorded: no organisation in context`,
      );
      return;
    }

    try {
      await this.repo.insert({
        organisationId,
        operation: input.operation,
        method: input.method,
        url: scrubDasActivityUrl(input.url),
        responseStatus: input.responseStatus,
        succeeded: input.succeeded,
        durationMs: input.durationMs,
        errorMessage: truncateDasActivityError(input.errorMessage ?? null),
        // TypeORM's insert typing does not accept a plain object for a jsonb
        // column; the audit subscriber casts the same way for `changes`.
        requestSummary: scrubDasActivitySummary(
          input.requestSummary,
        ) as QueryDeepPartialEntity<DasApiActivity>['requestSummary'],
        triggeredByUserId: getCurrentUserId() ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record DAS activity (${input.operation}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * F2.3.1 AC7 — read the log back, newest first.
   *
   * Ordered by `createdAt DESC, id DESC`: a sync cycle fires several calls
   * inside the same millisecond, and without the tiebreak those rows can swap
   * places between pages, so a row is shown twice and another never at all.
   */
  async list(
    organisationId: string,
    query: ListDasActivityQueryDto,
  ): Promise<{ items: DasApiActivity[]; meta: IPaginationMeta }> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const where: FindOptionsWhere<DasApiActivity> = { organisationId };
    if (query.operation) {
      where.operation = query.operation;
    }
    if (query.failedOnly === 'true') {
      where.succeeded = false;
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return { items, meta: buildPaginationMeta({ total, page, perPage }) };
  }

  /**
   * Retention pruning. The log grows with every call and its diagnostic value
   * decays quickly — nobody debugs a sync from six months ago, and ESFA
   * submission receipts are kept separately on the ILR submission records,
   * which are the durable evidence.
   */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.repo.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
