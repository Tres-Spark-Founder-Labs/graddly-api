import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { CaseloadAlertService } from '../learners/caseload-alert.service.js';

import { CronLockService } from './cron-lock.service.js';
import { CASELOAD_ALERTS_CRON_NAME } from './scheduler.constants.js';

/**
 * F2.2.5 AC3 — alert programme managers when a tutor is carrying more at-risk
 * learners than the configured threshold.
 *
 * 07:30, so the alert is waiting when the working day starts and lands after
 * the nightly OTJ pace and review-overdue jobs have settled — the at-risk
 * count is derived from both, and alerting mid-recalculation would produce a
 * number nobody could reproduce by opening the dashboard.
 */
@Injectable()
export class CaseloadAlertCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CaseloadAlertCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertService: CaseloadAlertService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.caseloadAlertsEnabled', false))
      return;

    const expression = this.config.get<string>(
      'app.cron.caseloadAlertsSchedule',
      '30 7 * * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleCaseloadAlertCron();
    });
    this.schedulerRegistry.addCronJob(CASELOAD_ALERTS_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${CASELOAD_ALERTS_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.deleteCronJob(CASELOAD_ALERTS_CRON_NAME);
    } catch {
      // Not registered — the flag was off. Nothing to tear down.
    }
  }

  async handleCaseloadAlertCron(): Promise<void> {
    /**
     * The lock matters more here than for a snapshot job: two instances
     * running this sweep sends every programme manager the same alert twice,
     * and an alerting system that cries wolf gets muted.
     */
    try {
      const outcome = await this.cronLock.runExclusive(
        CASELOAD_ALERTS_CRON_NAME,
        () => this.alertService.runSweep(),
      );

      if (!outcome.ran) {
        return;
      }

      this.logger.log(
        `Caseload alert sweep: ${outcome.result?.organisationsChecked} organisation(s), ${outcome.result?.alertsSent} alert(s) sent`,
      );
    } catch (error) {
      this.logger.error(
        `Caseload alert sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
