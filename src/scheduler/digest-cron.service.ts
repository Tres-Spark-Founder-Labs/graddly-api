import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { CronLockService } from './cron-lock.service.js';
import { DIGEST_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class DigestCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }

    if (!this.config.get<boolean>('app.cron.digestEnabled', false)) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.digestSchedule',
      '0 8 * * 1',
    );

    const job = new CronJob(expression, () => {
      void this.handleDigestCron();
    });

    this.schedulerRegistry.addCronJob(DIGEST_CRON_NAME, job);
    job.start();

    this.logger.log(
      `Registered "${DIGEST_CRON_NAME}" cron (${expression}) — log-only skeleton`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', DIGEST_CRON_NAME)) {
      return;
    }

    const job = this.schedulerRegistry.getCronJob(DIGEST_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(DIGEST_CRON_NAME);
  }

  async handleDigestCron(): Promise<void> {
    await this.cronLock.runExclusive(DIGEST_CRON_NAME, () => {
      this.logger.log(
        'Digest cron tick (skeleton): weekly OTJ digest enqueue deferred until Phase M',
      );
      return Promise.resolve();
    });
  }
}
