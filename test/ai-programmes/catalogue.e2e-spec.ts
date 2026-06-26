import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AI_PROGRAMME_CATALOGUE_SEED } from '../helpers/ai-programme-seed.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  createEmployerReportingContext,
  createFlowOrgContext,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('AiProgrammeCatalogueController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /ai-programmes/catalogue lists seeded AI programmes for Flow org', async () => {
    const ctx = await createFlowOrgContext(app, 'catalogue');

    const res = await request(app.getHttpServer())
      .get('/api/v1/ai-programmes/catalogue')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        deliveryType: 'flowportal_ai',
        moduleCount: expect.any(Number),
      }),
    );
  });

  it('GET /ai-programmes/catalogue/:programmeId returns module outline', async () => {
    const ctx = await createFlowOrgContext(app, 'catalogue-detail');
    const programmeId = AI_PROGRAMME_CATALOGUE_SEED.programmes[0].id;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/ai-programmes/catalogue/${programmeId}`)
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect(res.body.data.modules.length).toBe(3);
    expect(res.body.data.modules[0].slug).toBe('foundations');
  });

  it('returns 403 when active org is not Flow portal', async () => {
    const ctx = await createEmployerReportingContext(app, 'ai-cat-forbidden');

    await request(app.getHttpServer())
      .get('/api/v1/ai-programmes/catalogue')
      .set(ctx.authHeaders)
      .expect(403);
  });
});
