import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';

import { DasApiActivityService } from './das-api-activity.service.js';
import { DasFundingSyncService } from './das-funding-sync.service.js';
import { DasHttpClient } from './das-http.client.js';
import { DasLevyForecastService } from './das-levy-forecast.service.js';
import { DasLevyMonthlyService } from './das-levy-monthly.service.js';
import { DasLevySyncService } from './das-levy-sync.service.js';
import { DasOAuthService } from './das-oauth.service.js';
import { DasSyncDispatchService } from './das-sync-dispatch.service.js';
import { DasSyncStatusService } from './das-sync-status.service.js';
import { DasController } from './das.controller.js';
import { DasApiActivity } from './entities/das-api-activity.entity.js';
import { DasFundingPayment } from './entities/das-funding-payment.entity.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasLevyMonthlyEntry } from './entities/das-levy-monthly-entry.entity.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      DasLevyBalance,
      DasLevyMonthlyEntry,
      DasFundingPayment,
      // F2.3.1 AC5/AC7 — the API activity log, and the health derived from it.
      DasApiActivity,
      Organisation,
      Enrolment,
      Standard,
    ]),
  ],
  controllers: [DasController],
  providers: [
    DasOAuthService,
    DasHttpClient,
    DasLevyForecastService,
    DasLevyMonthlyService,
    DasLevySyncService,
    DasFundingSyncService,
    DasSyncDispatchService,
    DasApiActivityService,
    DasSyncStatusService,
  ],
  exports: [
    TypeOrmModule,
    DasOAuthService,
    DasHttpClient,
    DasLevyForecastService,
    DasLevyMonthlyService,
    DasLevySyncService,
    DasFundingSyncService,
    DasSyncDispatchService,
    DasApiActivityService,
    DasSyncStatusService,
  ],
})
export class DasModule {}
