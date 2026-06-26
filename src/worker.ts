import 'dotenv/config';

import './config/env-bootstrap.js';

import './database/postgres-query-runner.patch.js';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { WorkerModule } from './worker.module.js';

async function bootstrap() {
  const bootstrapLogger = new Logger('WorkerBootstrap');
  bootstrapLogger.log('Starting worker process…');

  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.enableShutdownHooks();
  await app.init();
  app.flushLogs();

  bootstrapLogger.log(
    'Worker process started (BullMQ processors and cron jobs active)',
  );
}

bootstrap().catch((_error: unknown) => {
  process.exit(1);
});
