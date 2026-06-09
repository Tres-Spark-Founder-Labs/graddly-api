/* eslint-disable @typescript-eslint/no-require-imports -- lazy load after Jest setupFiles configure env */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { getEnv } from '../../src/config/validate-env.js';
import { configureApp } from '../../src/configure-app.js';
import { configureHelmet } from '../../src/configure-helmet.js';

import type { App } from 'supertest/types';

export async function createE2eApp(
  options: { requireOidc?: boolean } = {},
): Promise<INestApplication<App>> {
  if (options.requireOidc && !getEnv().OIDC_ENABLED) {
    throw new Error(
      'OIDC e2e tests require OIDC_ENABLED=true (use the e2e-oidc Jest project)',
    );
  }

  // Loaded here so setupFiles can configure env / reset module cache first.

  const { AppModule } =
    require('../../src/app.module') as typeof import('../../src/app.module.js');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  configureHelmet(app);
  configureApp(app);
  await app.init();
  return app;
}
