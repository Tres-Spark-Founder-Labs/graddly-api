import { Injectable } from '@nestjs/common';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { DataRetentionService } from '../data-retention/data-retention.service.js';
import { RetentionRunLog } from '../data-retention/entities/retention-run-log.entity.js';
import { RetentionRunTrigger } from '../data-retention/enums/retention-run-trigger.enum.js';
import { RetentionRunLogService } from '../data-retention/retention-run-log.service.js';

import { RetentionRunResponseDto } from './dto/retention-run-response.dto.js';

@Injectable()
export class PlatformRetentionService {
  constructor(
    private readonly dataRetention: DataRetentionService,
    private readonly runLogService: RetentionRunLogService,
  ) {}

  async listRuns(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<RetentionRunResponseDto>> {
    const result = await this.runLogService.listRuns(query);
    return new PaginatedResult(
      result.items.map((item) => this.toDto(item)),
      result.meta,
    );
  }

  async runManual(): Promise<RetentionRunResponseDto> {
    const summary = await this.dataRetention.runRetentionJob({ force: true });
    const log = await this.runLogService.recordRun(
      RetentionRunTrigger.MANUAL,
      summary,
    );
    return this.toDto(log);
  }

  private toDto(log: RetentionRunLog): RetentionRunResponseDto {
    return {
      id: log.id,
      ranAt: log.ranAt.toISOString(),
      triggeredBy: log.triggeredBy,
      auditLogsPurged: log.auditLogsPurged,
      softDeletedPurged: log.softDeletedPurged,
      oldNotificationsPurged: log.oldNotificationsPurged,
    };
  }
}
