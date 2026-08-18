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

  /**
   * Bound here, once per suite, rather than left to supertest.
   *
   * With no address of its own, `app.getHttpServer()` makes supertest bind one
   * lazily on every request (`supertest/lib/test.js:61`):
   *
   *     const addr = app.address();
   *     if (!addr) this._server = app.listen(0);
   *
   * That is invisible while a suite is sequential, and a trap the moment one is
   * not: concurrent requests each observe a null address, race to bind the same
   * server, and the losers talk to a socket still coming up. It surfaces as
   * `connect ECONNRESET` with no failed expectation — a network fault by
   * appearance, a harness fault in fact, and nobody debugging it looks at the
   * harness first. It cost a session to find once (see OQ-18 and `392fc45`).
   *
   * Port 0 lets the OS pick a free port, so suites running in parallel workers
   * cannot collide. `app.close()` closes this listener along with everything
   * else, and every suite already calls it in `afterAll`.
   *
   * The lint rule in `eslint.config.mjs` keeps `test/**` sequential; this makes
   * the harness safe even if that rule is ever disabled with justification.
   */
  await app.listen(0);

  return app;
}
