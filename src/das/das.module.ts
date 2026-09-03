import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrSubmission } from '../ilr/entities/ilr-submission.entity.js';
import { DasDonorLink } from '../levy-exchange/entities/das-donor-link.entity.js';
import { DasLevyTranche } from '../levy-exchange/entities/das-levy-tranche.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';

import { DasApiActivityService } from './das-api-activity.service.js';
import { DAS_CLIENT } from './das-client.constants.js';
import { resolveDasClient } from './das-client.factory.js';
import { DasFundingSyncService } from './das-funding-sync.service.js';
import { DasHttpClient } from './das-http.client.js';
import { DasLevyForecastService } from './das-levy-forecast.service.js';
import { DasLevyMonthlyService } from './das-levy-monthly.service.js';
import { DasLevySyncService } from './das-levy-sync.service.js';
import { DasManualClient } from './das-manual.client.js';
import { DasManualController } from './das-manual.controller.js';
import { DasManualService } from './das-manual.service.js';
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
      // Manual entry writes across module boundaries: tranches and donor links
      // live in levy-exchange, the ILR receipt in ilr.
      DasDonorLink,
      DasLevyTranche,
      IlrSubmission,
    ]),
  ],
  controllers: [DasController, DasManualController],
  providers: [
    DasOAuthService,
    DasHttpClient,
    DasManualClient,
    DasManualService,
    /**
     * Which DAS client the platform runs on.
     *
     * Same shape as `COMPANIES_HOUSE_CLIENT` in
     * `flowportal-registration.module.ts`: an interface token, two
     * implementations, and a factory that picks one from config.
     *
     * With no `DAS_BASE_URL` there is nothing to call, so the manual client
     * serves figures an administrator entered instead. That is the difference
     * between a deployment that works while ESFA access is being arranged and
     * one that does not.
     */
    {
      provide: DAS_CLIENT,
      useFactory: resolveDasClient,
      inject: [ConfigService, DasHttpClient, DasManualClient],
    },
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
    DAS_CLIENT,
    DasHttpClient,
    DasManualClient,
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
