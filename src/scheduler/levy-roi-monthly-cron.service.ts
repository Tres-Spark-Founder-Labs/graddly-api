import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { LevyRoiMonthlyReportService } from '../reporting/levy-roi-monthly-report.service.js';

import { CronLockService } from './cron-lock.service.js';
import { LEVY_ROI_MONTHLY_CRON_NAME } from './scheduler.constants.js';

/**
 * F1.4.1 AC5 — "scheduled monthly email delivery to configurable recipients".
 *
 * Defaults to 07:00 on the 1st of each month. `CronLockService` keeps a
 * multi-instance deployment from sending the board report several times,
 * which matters more here than for a nightly recalculation: a duplicated
 * finance email gets noticed.
 */
@Injectable()
export class LevyRoiMonthlyCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LevyRoiMonthlyCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly monthlyReportService: LevyRoiMonthlyReportService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.levyRoiMonthlyEnabled', false))
      return;

    const expression = this.config.get<string>(
      'app.cron.levyRoiMonthlySchedule',
      '0 7 1 * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleLevyRoiMonthlyCron();
    });
    this.schedulerRegistry.addCronJob(LEVY_ROI_MONTHLY_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${LEVY_ROI_MONTHLY_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', LEVY_ROI_MONTHLY_CRON_NAME))
      return;
    const job = this.schedulerRegistry.getCronJob(LEVY_ROI_MONTHLY_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(LEVY_ROI_MONTHLY_CRON_NAME);
  }

  async handleLevyRoiMonthlyCron(): Promise<void> {
    await this.cronLock.runExclusive(LEVY_ROI_MONTHLY_CRON_NAME, async () => {
      const sent = await this.monthlyReportService.sendMonthlyReports();
      this.logger.log(`Monthly levy ROI report cron queued ${sent} email(s)`);
    });
  }
}
