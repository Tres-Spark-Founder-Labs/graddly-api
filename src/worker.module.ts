import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';

import { BullmqWorkerModule } from './bullmq/bullmq-worker.module.js';
import { BullmqModule } from './bullmq/bullmq.module.js';
import { LearnerScopeModule } from './common/learner-scope/learner-scope.module.js';
import appConfig from './config/app.config.js';
import { typeOrmForRoot } from './config/typeorm-module.factory.js';
import databaseConfig from './config/typeorm.config.js';
import { validateEnv } from './config/validate-env.js';
import { winstonConfigFactory } from './logger/winston.config.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [appConfig, databaseConfig],
    }),
    typeOrmForRoot(),
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: winstonConfigFactory,
    }),
    BullmqModule,
    /**
     * `LearnerScopeModule` is `@Global()`, which makes it available everywhere
     * *within the application that imports it* — and the worker is a second
     * root module, not part of `AppModule`. Without this import the worker dies
     * at boot resolving `LearnerScopeService` for `PdfJobsService`, and
     * `concurrently -k` then takes the API down with it, so every background
     * job and the HTTP server fail together.
     *
     * This is the third module-wiring crash of this shape (see 2f32cc1). The
     * cause each time is that unit tests mock providers and e2e boots
     * `AppModule`, so nothing exercised `WorkerModule` — `worker.module.spec.ts`
     * now compiles it, which is what makes the next one fail in CI rather than
     * at launch.
     */
    LearnerScopeModule,
    BullmqWorkerModule,
    SchedulerModule,
  ],
})
export class WorkerModule {}
