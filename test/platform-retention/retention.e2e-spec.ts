import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { PLATFORM_OPS_API_KEY_HEADER } from '../../src/platform-gdpr/platform-gdpr.constants.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import {
  applyPlatformOpsE2eEnv,
  disablePlatformOpsE2eEnv,
  E2E_PLATFORM_OPS_API_KEY,
} from '../helpers/platform-ops-e2e-env.js';

import type { App } from 'supertest/types';

function opsAuthHeaders(
  apiKey: string = E2E_PLATFORM_OPS_API_KEY,
): Record<string, string> {
  return { [PLATFORM_OPS_API_KEY_HEADER]: apiKey };
}

describe('Platform retention (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    applyPlatformOpsE2eEnv();
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
    disablePlatformOpsE2eEnv();
  });

  it('returns 401 without platform ops API key', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/platform/retention/runs')
      .expect(401);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 401,
      message: 'Invalid platform ops API key',
      path: '/api/v1/platform/retention/runs',
      error: 'Unauthorized',
    });
  });

  it('lists retention runs and records a manual run', async () => {
    const listBefore = await request(app.getHttpServer())
      .get('/api/v1/platform/retention/runs')
      .set(opsAuthHeaders())
      .expect(200);

    expectSuccessEnvelope(listBefore.body as Record<string, unknown>);
    expect(Array.isArray(listBefore.body.data)).toBe(true);

    const runRes = await request(app.getHttpServer())
      .post('/api/v1/platform/retention/run')
      .set(opsAuthHeaders())
      .expect(200);

    expectSuccessEnvelope(runRes.body as Record<string, unknown>);
    expect(runRes.body.data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        triggeredBy: 'manual',
        auditLogsPurged: expect.any(Number),
        softDeletedPurged: expect.any(Number),
        oldNotificationsPurged: expect.any(Number),
      }),
    );

    const listAfter = await request(app.getHttpServer())
      .get('/api/v1/platform/retention/runs')
      .set(opsAuthHeaders())
      .expect(200);

    expectSuccessEnvelope(listAfter.body as Record<string, unknown>);
    expect(listAfter.body.data.length).toBeGreaterThanOrEqual(1);
    expect(listAfter.body.meta).toEqual(
      expect.objectContaining({ total: expect.any(Number), page: 1 }),
    );
  });
});
