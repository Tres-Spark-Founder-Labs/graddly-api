import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { RetentionRunLog } from './entities/retention-run-log.entity.js';
import { RetentionRunTrigger } from './enums/retention-run-trigger.enum.js';

import type { RetentionRunSummary } from './data-retention.service.js';

@Injectable()
export class RetentionRunLogService {
  constructor(
    @InjectRepository(RetentionRunLog)
    private readonly runLogRepo: Repository<RetentionRunLog>,
  ) {}

  async recordRun(
    triggeredBy: RetentionRunTrigger,
    summary: RetentionRunSummary,
  ): Promise<RetentionRunLog> {
    const log = this.runLogRepo.create({
      ranAt: new Date(),
      triggeredBy,
      auditLogsPurged: summary.auditLogsPurged,
      softDeletedPurged: summary.softDeletedPurged,
      oldNotificationsPurged: summary.oldNotificationsPurged,
    });
    return this.runLogRepo.save(log);
  }

  async listRuns(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<RetentionRunLog>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const [items, total] = await this.runLogRepo.findAndCount({
      order: { ranAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }
}
