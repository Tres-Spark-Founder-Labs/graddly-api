import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import { DasSyncStatusResponseDto } from './dto/das-sync-status-response.dto.js';
import { DasApiActivity } from './entities/das-api-activity.entity.js';
import { DAS_SYNC_OPERATIONS } from './enums/das-api-operation.enum.js';
import { DasSyncHealth } from './enums/das-sync-health.enum.js';

/**
 * How far back the error count and health assessment look.
 *
 * A day, because that is the cadence the sync actually runs at — an error
 * count over an hour would read zero for most of the day on a nightly sync
 * and tell a provider nothing.
 */
export const DAS_SYNC_STATUS_WINDOW_HOURS = 24;

/**
 * How stale a successful sync may be before the indicator stops calling it
 * green. Set above the window so a healthy nightly sync does not flicker
 * amber in the hours before its next run.
 */
export const DAS_SYNC_STALE_AFTER_HOURS = 26;

@Injectable()
export class DasSyncStatusService {
  constructor(
    @InjectRepository(DasApiActivity)
    private readonly repo: Repository<DasApiActivity>,
  ) {}

  /**
   * F2.3.1 AC5. Derived from `das_api_activity`, never stored.
   *
   * A cached status column would be one more thing that can be stale, and its
   * staleness would show up as a green light over a list of failures — the
   * precise thing a health indicator exists to prevent.
   */
  async getStatus(organisationId: string): Promise<DasSyncStatusResponseDto> {
    const windowStart = new Date(
      Date.now() - DAS_SYNC_STATUS_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const [lastSuccess, lastAttempt, lastFailure, errorCount] =
      await Promise.all([
        this.repo.findOne({
          where: {
            organisationId,
            operation: In([...DAS_SYNC_OPERATIONS]),
            succeeded: true,
          },
          order: { createdAt: 'DESC' },
        }),
        this.repo.findOne({
          where: { organisationId, operation: In([...DAS_SYNC_OPERATIONS]) },
          order: { createdAt: 'DESC' },
        }),
        // Not restricted to sync operations: a failing submission is a sync
        // problem the provider needs to see, even though it is not a "sync".
        this.repo.findOne({
          where: { organisationId, succeeded: false },
          order: { createdAt: 'DESC' },
        }),
        this.repo.count({
          where: {
            organisationId,
            succeeded: false,
            createdAt: MoreThanOrEqual(windowStart),
          },
        }),
      ]);

    return {
      lastSyncAt: lastSuccess?.createdAt.toISOString() ?? null,
      lastAttemptAt: lastAttempt?.createdAt.toISOString() ?? null,
      health: this.computeHealth({
        lastSuccessAt: lastSuccess?.createdAt ?? null,
        lastAttempt,
        errorCount,
      }),
      errorCount,
      windowHours: DAS_SYNC_STATUS_WINDOW_HOURS,
      lastErrorMessage: lastFailure?.errorMessage ?? null,
    };
  }

  private computeHealth({
    lastSuccessAt,
    lastAttempt,
    errorCount,
  }: {
    lastSuccessAt: Date | null;
    lastAttempt: DasApiActivity | null;
    errorCount: number;
  }): DasSyncHealth {
    /**
     * Never synced at all is red, not green.
     *
     * The tempting reading is "no errors, so nothing is wrong". But a provider
     * whose DAS integration has never once succeeded is in the worst state
     * this indicator can describe, and showing them green would be the single
     * most misleading thing on the page.
     */
    if (!lastSuccessAt || !lastAttempt) {
      return DasSyncHealth.RED;
    }

    // The most recent attempt failing outranks everything else: whatever the
    // history, right now it is broken.
    if (!lastAttempt.succeeded) {
      return DasSyncHealth.RED;
    }

    const hoursSinceSuccess =
      (Date.now() - lastSuccessAt.getTime()) / (60 * 60 * 1000);
    if (hoursSinceSuccess > DAS_SYNC_STALE_AFTER_HOURS) {
      return DasSyncHealth.AMBER;
    }

    // Succeeding now, but not cleanly. Amber rather than green because
    // intermittent failure is what precedes sustained failure, and it is the
    // state worth investigating before it becomes red.
    return errorCount > 0 ? DasSyncHealth.AMBER : DasSyncHealth.GREEN;
  }
}
