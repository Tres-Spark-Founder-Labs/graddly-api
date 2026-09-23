import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { MilestoneNotificationsService } from '../enrolments/milestone-notifications.service.js';

import { CronLockService } from './cron-lock.service.js';
import { MILESTONE_NOTIFICATIONS_CRON_NAME } from './scheduler.constants.js';

/**
 * F3.4.3 AC2 — the daily sweep that announces completed journey milestones.
 *
 * Journey milestones are derived on read, so there is no transition to emit
 * from; the sweep recomputes and compares against its markers. The decision
 * and its alternative are recorded on `MilestoneNotificationsService`.
 *
 * Daily rather than more often because a milestone is not time-critical: the
 * learner is being told about something they have already done, and the sweep
 * recomputes a whole journey per enrolment, which makes it the most expensive
 * job in this directory.
 */
@Injectable()
export class MilestoneNotificationsCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MilestoneNotificationsCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly milestoneNotifications: MilestoneNotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) {
      return;
    }
    if (
      !this.config.get<boolean>('app.cron.milestoneNotificationsEnabled', false)
    ) {
      return;
    }

    const expression = this.config.get<string>(
      'app.cron.milestoneNotificationsSchedule',
      '0 6 * * *',
    );

    const job = new CronJob(expression, () => {
      void this.handleMilestoneNotificationsCron();
    });

    this.schedulerRegistry.addCronJob(MILESTONE_NOTIFICATIONS_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${MILESTONE_NOTIFICATIONS_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (
      !this.schedulerRegistry.doesExist(
        'cron',
        MILESTONE_NOTIFICATIONS_CRON_NAME,
      )
    ) {
      return;
    }
    const job = this.schedulerRegistry.getCronJob(
      MILESTONE_NOTIFICATIONS_CRON_NAME,
    );
    void job.stop();
    this.schedulerRegistry.deleteCronJob(MILESTONE_NOTIFICATIONS_CRON_NAME);
  }

  /**
   * `now` is a parameter for the same reason the review reminders' is: the
   * sweep stamps `milestonesObservedAt` and the marker rows from it, and a
   * test that cannot choose the moment cannot prove the seeding rule.
   * Production passes nothing.
   */
  async handleMilestoneNotificationsCron(
    now: Date = new Date(),
  ): Promise<void> {
    await this.cronLock.runExclusive(
      MILESTONE_NOTIFICATIONS_CRON_NAME,
      async () => {
        const result =
          await this.milestoneNotifications.notifyCompletedMilestones(now);
        this.logger.log(
          `Milestone notifications: ${result.notified} announced across ${result.enrolmentsChecked} enrolment(s)`,
        );
      },
    );
  }
}
