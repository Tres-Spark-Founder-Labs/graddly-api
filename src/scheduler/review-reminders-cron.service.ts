import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { ReviewsReminderService } from '../reviews/reviews-reminder.service.js';

import { CronLockService } from './cron-lock.service.js';
import { REVIEW_REMINDERS_CRON_NAME } from './scheduler.constants.js';

@Injectable()
export class ReviewRemindersCronService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReviewRemindersCronService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly reminderService: ReviewsReminderService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('app.cron.enabled', true)) return;
    if (!this.config.get<boolean>('app.cron.reviewRemindersEnabled', false))
      return;

    const expression = this.config.get<string>(
      'app.cron.reviewRemindersSchedule',
      '0 * * * *',
    );
    const job = new CronJob(expression, () => {
      void this.handleReviewRemindersCron();
    });
    this.schedulerRegistry.addCronJob(REVIEW_REMINDERS_CRON_NAME, job);
    job.start();
    this.logger.log(
      `Registered "${REVIEW_REMINDERS_CRON_NAME}" cron (${expression})`,
    );
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('cron', REVIEW_REMINDERS_CRON_NAME))
      return;
    const job = this.schedulerRegistry.getCronJob(REVIEW_REMINDERS_CRON_NAME);
    void job.stop();
    this.schedulerRegistry.deleteCronJob(REVIEW_REMINDERS_CRON_NAME);
  }

  async handleReviewRemindersCron(): Promise<void> {
    await this.cronLock.runExclusive(REVIEW_REMINDERS_CRON_NAME, async () => {
      const sent = await this.reminderService.sendDueReminders();
      this.logger.log(`Review reminders cron sent ${sent} reminder batches`);
    });
  }
}
