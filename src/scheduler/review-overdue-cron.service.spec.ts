import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';

import { ReviewsOverdueService } from '../reviews/reviews-overdue.service.js';

import { CronLockService } from './cron-lock.service.js';
import { ReviewOverdueCronService } from './review-overdue-cron.service.js';
import { REVIEW_OVERDUE_CRON_NAME } from './scheduler.constants.js';

describe('ReviewOverdueCronService', () => {
  let service: ReviewOverdueCronService;
  let overdueService: jest.Mocked<
    Pick<ReviewsOverdueService, 'flagOverdueReviews'>
  >;
  let schedulerRegistry: jest.Mocked<
    Pick<
      SchedulerRegistry,
      'addCronJob' | 'doesExist' | 'getCronJob' | 'deleteCronJob'
    >
  >;
  const cronJobs = new Map<string, { stop: jest.Mock }>();

  beforeEach(async () => {
    cronJobs.clear();
    overdueService = {
      flagOverdueReviews: jest.fn().mockResolvedValue(3),
    };
    schedulerRegistry = {
      addCronJob: jest.fn((name: string, job: { stop: jest.Mock }) => {
        cronJobs.set(name, job);
      }),
      doesExist: jest.fn((_type: string, name: string) => cronJobs.has(name)),
      getCronJob: jest.fn((name: string) => cronJobs.get(name)),
      deleteCronJob: jest.fn((name: string) => {
        cronJobs.delete(name);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewOverdueCronService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'app.cron.enabled') return true;
              if (key === 'app.cron.reviewOverdueEnabled') return true;
              if (key === 'app.cron.reviewOverdueSchedule') return '0 2 * * *';
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
        { provide: ReviewsOverdueService, useValue: overdueService },
      ],
    }).compile();

    service = moduleRef.get(ReviewOverdueCronService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('handleReviewOverdueCron', () => {
    it('flags overdue reviews under lock', async () => {
      await service.handleReviewOverdueCron();

      expect(overdueService.flagOverdueReviews).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the review overdue cron when enabled', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        REVIEW_OVERDUE_CRON_NAME,
        expect.objectContaining({}),
      );
    });
  });
});
