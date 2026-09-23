import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { ReviewsReminderService } from '../reviews/reviews-reminder.service.js';

import { CronLockService } from './cron-lock.service.js';
import { ReviewRemindersCronService } from './review-reminders-cron.service.js';
import { REVIEW_REMINDERS_CRON_NAME } from './scheduler.constants.js';
import {
  createSchedulerRegistryDouble,
  type SchedulerRegistryDouble,
} from './testing/scheduler-registry.double.js';

describe('ReviewRemindersCronService', () => {
  let service: ReviewRemindersCronService;
  let reminderService: jest.Mocked<
    Pick<ReviewsReminderService, 'sendDueReminders'>
  >;
  let schedulerRegistry: SchedulerRegistryDouble['registry'];
  let cronJobs: SchedulerRegistryDouble['jobs'];

  beforeEach(async () => {
    reminderService = {
      sendDueReminders: jest.fn().mockResolvedValue(4),
    };
    ({ registry: schedulerRegistry, jobs: cronJobs } =
      createSchedulerRegistryDouble());

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewRemindersCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.reviewRemindersEnabled') return true;
              if (key === 'app.cron.reviewRemindersSchedule')
                return '0 7 * * *';
              return defaultValue;
            }),
          },
        },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        {
          provide: CronLockService,
          useValue: {
            runExclusive: jest.fn(
              async (_name: string, fn: () => Promise<void>) => {
                await fn();
                return { ran: true };
              },
            ),
          },
        },
        { provide: ReviewsReminderService, useValue: reminderService },
      ],
    }).compile();

    service = moduleRef.get(ReviewRemindersCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleReviewRemindersCron', () => {
    it('sends due review reminders under lock', async () => {
      await service.handleReviewRemindersCron();

      expect(reminderService.sendDueReminders).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the review reminders cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        REVIEW_REMINDERS_CRON_NAME,
        expect.objectContaining({}),
      );
    });
  });
});
