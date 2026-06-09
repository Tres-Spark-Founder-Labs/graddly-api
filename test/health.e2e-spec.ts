import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';

import type { App } from 'supertest/types';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 with status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    const status =
      (res.body as { status?: string }).status ??
      (res.body as { data?: { status?: string } }).data?.status;

    expect(status).toBe('ok');
  });
});
