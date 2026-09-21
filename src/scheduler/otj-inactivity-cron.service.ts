import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { OtjInactivityService } from '../otj/otj-inactivity.service.js';

import { CronLockService } from './cron-lock.service.js';
import { OTJ_INACTIVITY_CRON_NAME } from './scheduler.constants.js';

/**
 * F3.1.4 AC4 — daily sweep for apprentices who have logged nothing in seven
 * days. The same shape as `OtjPaceCronService`: registered only when
 * `CRON_OTJ_INACTIVITY_ENABLED` is true, one replica at a time through the
 * Redis lock. The once-per-week rule lives in the service, not the schedule.
 */
@Injectable()
export class OtjInactivityCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OtjInactivityCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly inactivityService: OtjInactivityService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.otjInactivityEnabled', false))
      return;

    const expression = this.config.get<string>(
      'app.cron.otjInactivitySchedule',
      '0 9 * * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleOtjInactivityCron();
    });
    this.schedulerRegistry.addCronJob(OTJ_INACTIVITY_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${OTJ_INACTIVITY_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', OTJ_INACTIVITY_CRON_NAME))
      return;
    const job = this.schedulerRegistry.getCronJob(OTJ_INACTIVITY_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(OTJ_INACTIVITY_CRON_NAME);
  }

  async handleOtjInactivityCron(): Promise<void> {
    await this.cronLock.runExclusive(OTJ_INACTIVITY_CRON_NAME, async () => {
      const result = await this.inactivityService.alertInactiveApprentices();
      this.logger.log(
        `OTJ inactivity cron: ${result.checked} apprentices checked, ` +
          `${result.inactive} inactive, ${result.alerted} alerted ` +
          `(${result.pushed} pushed), ${result.alreadyAlerted} already alerted this week`,
      );
    });
  }
}
