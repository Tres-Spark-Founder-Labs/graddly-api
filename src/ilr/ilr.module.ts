import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { IlrLearnerRecord } from './entities/ilr-learner-record.entity.js';
import { IlrMappingConfig } from './entities/ilr-mapping-config.entity.js';
import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrEsfaHttpClient } from './ilr-esfa-http.client.js';
import { IlrEsfaNoopClient } from './ilr-esfa-noop.client.js';
import { IlrEsfaOAuthService } from './ilr-esfa-oauth.service.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrLearnerRecordsController } from './ilr-learner-records.controller.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrMappingConfigService } from './ilr-mapping-config.service.js';
import { IlrMappingConfigsController } from './ilr-mapping-configs.controller.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { IlrRowBuilderService } from './ilr-row-builder.service.js';
import { IlrSubmissionService } from './ilr-submission.service.js';
import { IlrSubmissionsController } from './ilr-submissions.controller.js';
import { IlrValidationEngine } from './ilr-validation-engine.service.js';
import { ILR_ESFA_CLIENT } from './ilr.constants.js';

import type { IIlrEsfaClient } from './interfaces/ilr-esfa.client.interface.js';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      IlrMappingConfig,
      IlrLearnerRecord,
      IlrSubmission,
      Enrolment,
      Organisation,
    ]),
  ],
  controllers: [
    IlrMappingConfigsController,
    IlrLearnerRecordsController,
    IlrSubmissionsController,
  ],
  providers: [
    IlrMappingConfigService,
    IlrLearnerRecordsService,
    IlrSubmissionService,
    IlrEnrolmentContext,
    IlrRowBuilderService,
    IlrValidationEngine,
    IlrLearnerRecordStatusService,
    IlrPayloadSerializerService,
    IlrEsfaOAuthService,
    IlrEsfaNoopClient,
    IlrEsfaHttpClient,
    {
      provide: ILR_ESFA_CLIENT,
      useFactory: (
        config: ConfigService,
        noop: IlrEsfaNoopClient,
        http: IlrEsfaHttpClient,
      ): IIlrEsfaClient => {
        const provider = config.get<'noop' | 'http'>(
          'app.ilr.esfa.provider',
          'noop',
        );
        return provider === 'http' ? http : noop;
      },
      inject: [ConfigService, IlrEsfaNoopClient, IlrEsfaHttpClient],
    },
  ],
  exports: [TypeOrmModule, IlrLearnerRecordsService, IlrSubmissionService],
})
export class IlrModule {}
