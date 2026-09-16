import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { runWithTenantContext } from '../common/context/correlation-id-context.js';
import { RedisService } from '../redis/redis.service.js';

export interface ICronLockRunResult<T> {
  ran: boolean;
  result?: T;
}

@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);
  private readonly instanceId = randomUUID();

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Runs fn only on the instance that acquires the Redis lock for this job name.
   * Other replicas skip without error.
   */
  async runExclusive<T>(
    jobName: string,
    fn: () => Promise<T>,
    options?: { ttlSeconds?: number },
  ): Promise<ICronLockRunResult<T>> {
    /**
     * The cron's own tenant store, carrying no organisation: a sweep reads
     * across tenants inside withRlsBootstrap and enters a per-organisation
     * store (runWithTenantContext) for anything scoped. Without this a cron
     * had no store at all and its setters wrote a process-global fallback
     * that every concurrent job and request could read.
     */
    const run = (): Promise<T> =>
      runWithTenantContext({ label: `cron:${jobName}` }, fn);

    if (!this.config.get<boolean>('app.cron.lockEnabled', true)) {
      const result = await run();
      return { ran: true, result };
    }

    const key = this.lockKey(jobName);
    const ttlSeconds =
      options?.ttlSeconds ??
      this.config.get<number>('app.cron.lockTtlSeconds', 240);

    const acquired = await this.redis.setNx(key, this.instanceId, ttlSeconds);
    if (!acquired) {
      this.logger.debug(
        `Cron "${jobName}" skipped — lock held by another instance`,
      );
      return { ran: false };
    }

    try {
      const result = await run();
      return { ran: true, result };
    } finally {
      await this.redis.releaseLockIfOwner(key, this.instanceId);
    }
  }

  private lockKey(jobName: string): string {
    const prefix = this.config.get<string>('app.bullmq.prefix', 'graddly');
    return `${prefix}:cron:lock:${jobName}`;
  }
}
