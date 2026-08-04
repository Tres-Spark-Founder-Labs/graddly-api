import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommitmentsModule } from '../commitments/commitments.module.js';
import { DasModule } from '../das/das.module.js';
import { DataRetentionCronService } from '../data-retention/data-retention-cron.service.js';
import { DataRetentionModule } from '../data-retention/data-retention.module.js';
import { RedisHealthIndicator } from '../health/redis-health.indicator.js';
import { LearnersModule } from '../learners/learners.module.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyExchangeModule } from '../levy-exchange/levy-exchange.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjModule } from '../otj/otj.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';

import { CaseloadAlertCronService } from './caseload-alert-cron.service.js';
import { CommitmentChaseCronService } from './commitment-chase-cron.service.js';
import { CronLockService } from './cron-lock.service.js';
import { DasFundingSyncCronService } from './das-funding-sync-cron.service.js';
import { DasSyncCronService } from './das-sync-cron.service.js';
import { DigestCronService } from './digest-cron.service.js';
import { EifSnapshotCronService } from './eif-snapshot-cron.service.js';
import { HealthCronService } from './health-cron.service.js';
import { LevyExpiryAlertsCronService } from './levy-expiry-alerts-cron.service.js';
import { LevyRoiMonthlyCronService } from './levy-roi-monthly-cron.service.js';
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
    DataRetentionModule,
    CommitmentsModule,
    NotificationsModule,
    // F1.4.1 AC5 — the monthly ROI report cron.
    ReportingModule,
    // F2.2.5 AC3 — the tutor at-risk caseload alert sweep.
    LearnersModule,
    TypeOrmModule.forFeature([Organisation, LevyTransfer, OtjLogEntry]),
  ],
  providers: [
    RedisHealthIndicator,
    CronLockService,
    HealthCronService,
    DigestCronService,
    DasSyncCronService,
    DasFundingSyncCronService,
    OtjPaceCronService,
    ReviewOverdueCronService,
    ReviewRemindersCronService,
    CommitmentChaseCronService,
    LevyExpiryAlertsCronService,
    LevyRoiMonthlyCronService,
    EifSnapshotCronService,
    CaseloadAlertCronService,
    LevyTransferStatusCronService,
    DataRetentionCronService,
  ],
  exports: [CronLockService],
})
export class SchedulerModule {}
