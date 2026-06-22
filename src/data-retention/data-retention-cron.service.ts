import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { CronLockService } from '../scheduler/cron-lock.service.js';
import { RETENTION_CRON_NAME } from '../scheduler/scheduler.constants.js';

import { DataRetentionService } from './data-retention.service.js';
import { RetentionRunTrigger } from './enums/retention-run-trigger.enum.js';
import { RetentionRunLogService } from './retention-run-log.service.js';

@Injectable()
export class DataRetentionCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly retentionService: DataRetentionService,
    private readonly runLogService: RetentionRunLogService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.retentionEnabled', false)) return;

    const expression = this.config.get<string>(
      'app.cron.retentionSchedule',
      '0 4 * * 0',
    );
    const job = new CronJob(expression, () => {
      void this.handleRetentionCron();
    });
    this.schedulerRegistry.addCronJob(RETENTION_CRON_NAME, job);
    job.start();
    this.logger.log(`Registered "${RETENTION_CRON_NAME}" cron (${expression})`);
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', RETENTION_CRON_NAME)) return;
    const job = this.schedulerRegistry.getCronJob(RETENTION_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(RETENTION_CRON_NAME);
  }

  async handleRetentionCron(): Promise<void> {
    await this.cronLock.runExclusive(RETENTION_CRON_NAME, async () => {
      const summary = await this.retentionService.runRetentionJob();
      await this.runLogService.recordRun(RetentionRunTrigger.CRON, summary);
      this.logger.log(
        `Retention cron: audit=${summary.auditLogsPurged} softDeleted=${summary.softDeletedPurged} notifications=${summary.oldNotificationsPurged}`,
      );
    });
  }
}
