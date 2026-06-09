import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DasModule } from '../das/das.module.js';
import { RedisHealthIndicator } from '../health/redis-health.indicator.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyExchangeModule } from '../levy-exchange/levy-exchange.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjModule } from '../otj/otj.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';

import { CronLockService } from './cron-lock.service.js';
import { DasSyncCronService } from './das-sync-cron.service.js';
import { DigestCronService } from './digest-cron.service.js';
import { HealthCronService } from './health-cron.service.js';
import { LevyExpiryAlertsCronService } from './levy-expiry-alerts-cron.service.js';
import { LevyTransferStatusCronService } from './levy-transfer-status-cron.service.js';
import { OtjPaceCronService } from './otj-pace-cron.service.js';
import { ReviewOverdueCronService } from './review-overdue-cron.service.js';
import { ReviewRemindersCronService } from './review-reminders-cron.service.js';

@Module({
  imports: [
    ScheduleModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        cronJobs: config.get<boolean>('app.cron.enabled', true),
      }),
    }),
    TerminusModule,
    RedisModule,
    DasModule,
    OtjModule,
    ReviewsModule,
    LevyExchangeModule,
    TypeOrmModule.forFeature([Organisation, LevyTransfer]),
  ],
  providers: [
    RedisHealthIndicator,
    CronLockService,
    HealthCronService,
    DigestCronService,
    DasSyncCronService,
    OtjPaceCronService,
    ReviewOverdueCronService,
    ReviewRemindersCronService,
    LevyExpiryAlertsCronService,
    LevyTransferStatusCronService,
  ],
  exports: [CronLockService],
})
export class SchedulerModule {}
