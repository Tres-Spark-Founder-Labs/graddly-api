import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { LevyExpiryAlertService } from '../levy-exchange/services/levy-expiry-alert.service.js';

import { CronLockService } from './cron-lock.service.js';
import { LEVY_EXPIRY_ALERTS_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class LevyExpiryAlertsCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LevyExpiryAlertsCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertService: LevyExpiryAlertService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.levyExpiryAlertsEnabled', false))
      return;

    const expression = this.config.get<string>(
      'app.cron.levyExpiryAlertsSchedule',
      '0 8 * * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleLevyExpiryAlertsCron();
    });
    this.schedulerRegistry.addCronJob(LEVY_EXPIRY_ALERTS_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${LEVY_EXPIRY_ALERTS_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', LEVY_EXPIRY_ALERTS_CRON_NAME))
      return;
    const job = this.schedulerRegistry.getCronJob(LEVY_EXPIRY_ALERTS_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(LEVY_EXPIRY_ALERTS_CRON_NAME);
  }

  async handleLevyExpiryAlertsCron(): Promise<void> {
    await this.cronLock.runExclusive(LEVY_EXPIRY_ALERTS_CRON_NAME, async () => {
      const sent = await this.alertService.sendDueAlerts();
      this.logger.log(`Levy expiry alerts cron sent ${sent} alert(s)`);
    });
  }
}
