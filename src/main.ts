import 'dotenv/config';

import './config/env-bootstrap.js';

import './database/postgres-query-runner.patch.js';

import './instrument.js';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import basicAuth from 'express-basic-auth';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { configureHelmet } from './configure-helmet.js';
import { assertRlsEnforced } from './database/assert-rls-enforced.js';
import { buildSwaggerConfig } from './swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.enableShutdownHooks();
  configureHelmet(app);
  configureApp(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);

  const swaggerUser = config.get<string>('app.swagger.username', 'graddly');
  const swaggerPass = config.get<string>('app.swagger.password', '');

  /**
   * `/docs` — both the basic-auth gate and the documentation itself are
   * mounted together, or neither is.
   *
   * Two faults are being fixed here at once:
   *
   * 1. The password fell back to a literal compiled into the binary, so any
   *    environment that had not set `SWAGGER_PASSWORD` was live on a
   *    credential published in this repository, while looking protected.
   *
   * 2. The auth middleware and the docs were mounted in *separate*
   *    `app.use('/docs', …)` calls. Gating only the first would have left the
   *    full API schema served with no authentication at all — strictly worse
   *    than the known password. They are one unit and must stay one unit.
   */
  if (swaggerPass) {
    app.use(
      '/docs',
      basicAuth({ challenge: true, users: { [swaggerUser]: swaggerPass } }),
    );

    const openApiDocument = SwaggerModule.createDocument(
      app,
      buildSwaggerConfig(),
    );

    app.use('/docs', apiReference({ content: openApiDocument }));
  } else {
    new Logger('Bootstrap').warn(
      'SWAGGER_PASSWORD is not set — /docs is disabled. Set it to enable the API documentation.',
    );
  }

  /**
   * Security pass item 2 — runs on every boot, dev and CI alike, so a
   * connection that bypasses tenant isolation cannot start quietly.
   */
  await assertRlsEnforced(app.get(DataSource));

  await app.listen(port);
}
void bootstrap();
