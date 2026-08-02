import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { EifScoreSnapshotService } from '../ofsted/eif-score-snapshot.service.js';

import { CronLockService } from './cron-lock.service.js';
import { EIF_SNAPSHOT_CRON_NAME } from './scheduler.constants.js';

/**
 * F2.1.1 — records each provider's EIF scores once a day so the twelve-month
 * trend has something to draw.
 *
 * Runs at 02:00, after the nightly OTJ pace and review-overdue jobs have
 * settled, so the score reflects a stable end-of-day picture rather than one
 * taken mid-recalculation.
 *
 * `CronLockService` keeps a multi-instance deployment from capturing twice.
 * The unique index on (organisation, day) makes that harmless rather than
 * merely unlikely — belt and braces, because a duplicated point on a
 * compliance chart is the kind of thing an inspector would ask about.
 */
@Injectable()
export class EifSnapshotCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EifSnapshotCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly snapshotService: EifScoreSnapshotService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.eifSnapshotEnabled', false)) return;

    const expression = this.config.get<string>(
      'app.cron.eifSnapshotSchedule',
      '0 2 * * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleEifSnapshotCron();
    });
    this.schedulerRegistry.addCronJob(EIF_SNAPSHOT_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${EIF_SNAPSHOT_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', EIF_SNAPSHOT_CRON_NAME))
      return;
    const job = this.schedulerRegistry.getCronJob(EIF_SNAPSHOT_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(EIF_SNAPSHOT_CRON_NAME);
  }

  async handleEifSnapshotCron(): Promise<void> {
    await this.cronLock.runExclusive(EIF_SNAPSHOT_CRON_NAME, async () => {
      const captured = await this.snapshotService.captureAll();
      this.logger.log(`EIF snapshot cron captured ${captured} organisation(s)`);
    });
  }
}
