import 'dotenv/config';

import './config/env-bootstrap.js';

import './database/postgres-query-runner.patch.js';

import './instrument.js';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import basicAuth from 'express-basic-auth';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { configureHelmet } from './configure-helmet.js';
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
  const swaggerPass = config.get<string>(
    'app.swagger.password',
    'Gr4ddly!Sw4g@2026#Sec',
  );

  app.use(
    '/docs',
    basicAuth({ challenge: true, users: { [swaggerUser]: swaggerPass } }),
  );

  const openApiDocument = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig(),
  );

  app.use(
    '/docs',
    apiReference({
      content: openApiDocument,
    }),
  );

  await app.listen(port);
}
void bootstrap();
