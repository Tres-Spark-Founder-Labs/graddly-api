import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { WinstonModule } from 'nest-winston';

import { AiProgrammesModule } from './ai-programmes/ai-programmes.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApprenticesModule } from './apprentices/apprentices.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OidcSessionMiddleware } from './auth/oidc/middleware/oidc-session.middleware.js';
import { BullmqOpsModule } from './bullmq/bullmq-ops.module.js';
import { BullmqModule } from './bullmq/bullmq.module.js';
import { CommitmentsModule } from './commitments/commitments.module.js';
import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard.js';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor.js';
import { LearnerScopeInterceptor } from './common/learner-scope/learner-scope.interceptor.js';
import { LearnerScopeModule } from './common/learner-scope/learner-scope.module.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { RlsBootstrapMiddleware } from './common/middleware/rls-bootstrap.middleware.js';
import { CompletionPushModule } from './completion-push/completion-push.module.js';
import appConfig from './config/app.config.js';
import { typeOrmForRoot } from './config/typeorm-module.factory.js';
import databaseConfig from './config/typeorm.config.js';
// import { TenantSessionSubscriber } from './database/tenant-session.subscriber.js';
import { getEnv, validateEnv } from './config/validate-env.js';
import { DasModule } from './das/das.module.js';
import { EmployerVisitsModule } from './employer-visits/employer-visits.module.js';
import { EnrolmentPushModule } from './enrolment-push/enrolment-push.module.js';
import { EnrolmentsModule } from './enrolments/enrolments.module.js';
import { EsignatureModule } from './esignature/esignature.module.js';
import { FlowportalRegistrationModule } from './flowportal-registration/flowportal-registration.module.js';
import { HealthModule } from './health/health.module.js';
import { IlrModule } from './ilr/ilr.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { LearnersModule } from './learners/learners.module.js';
import { LevyExchangeModule } from './levy-exchange/levy-exchange.module.js';
import { winstonConfigFactory } from './logger/winston.config.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OfstedModule } from './ofsted/ofsted.module.js';
import { OrganisationsModule } from './organisations/organisations.module.js';
import { OtjModule } from './otj/otj.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { PlatformGdprModule } from './platform-gdpr/platform-gdpr.module.js';
import { PlatformRetentionModule } from './platform-retention/platform-retention.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { ProgrammesModule } from './programmes/programmes.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ReportingModule } from './reporting/reporting.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SurveysModule } from './surveys/surveys.module.js';
import { UsersModule } from './users/users.module.js';
import { WithdrawalPushModule } from './withdrawal-push/withdrawal-push.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [appConfig, databaseConfig],
      ...(process.env.NODE_ENV === 'test' ? { envFilePath: '.env.test' } : {}),
    }),
    SentryModule.forRoot(),
    typeOrmForRoot({ migrationsRun: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 100 },
          { name: 'auth', ttl: 60_000, limit: 5 },
        ],
        storage: new ThrottlerStorageRedisService({
          host: config.get<string>('app.redis.host', 'localhost'),
          port: config.get<number>('app.redis.port', 6379),
          password: config.get<string>('app.redis.password'),
          family: 0,
        }),
      }),
    }),
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: winstonConfigFactory,
    }),
    RedisModule,
    BullmqModule,
    BullmqOpsModule,
    UsersModule,
    AuthModule,
    OrganisationsModule,
    InvitationsModule,
    NotificationsModule,
    OtjModule,
    OfstedModule,
    ReviewsModule,
    CommitmentsModule,
    PortfolioModule,
    LearnersModule,
    IlrModule,
    StorageModule,
    DasModule,
    LevyExchangeModule,
    FlowportalRegistrationModule,
    AiProgrammesModule,
    ProgrammesModule,
    ApprenticesModule,
    EnrolmentsModule,
    // F2.4.2 — employer visit log, and F2.4.1's lastVisitDate.
    EmployerVisitsModule,
    // F2.4.3 — employer satisfaction surveys.
    SurveysModule,
    MessagingModule,
    ReportingModule,
    WithdrawalPushModule,
    EnrolmentPushModule,
    CompletionPushModule,
    PdfModule,
    EsignatureModule,
    AuditModule,
    PlatformGdprModule,
    PlatformRetentionModule,
    HealthModule,
    LearnerScopeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    /**
     * Client decision D3. Registered after TenantContextInterceptor so the
     * tenant GUCs are already in the ALS when this runs, and last among the
     * global interceptors so a refusal happens before any handler executes.
     */
    { provide: APP_INTERCEPTOR, useClass: LearnerScopeInterceptor },
    ...(getEnv().OIDC_ENABLED ? [OidcSessionMiddleware] : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware, RlsBootstrapMiddleware)
      .forRoutes('*path');

    if (getEnv().OIDC_ENABLED) {
      consumer.apply(OidcSessionMiddleware).forRoutes({
        path: 'auth/oidc',
        method: RequestMethod.ALL,
        version: '1',
      });
    }
  }
}
