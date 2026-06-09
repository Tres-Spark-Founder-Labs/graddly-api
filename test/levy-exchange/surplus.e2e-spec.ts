import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { expectSurplusEntry } from '../helpers/levy-exchange-contracts.js';
import {
  createLexOrgContext,
  seedDonorLink,
  seedLinkedDonor,
} from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange surplus (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns empty surplus, recomputes, and lists expiry calendar', async () => {
    const ctx = await createLexOrgContext(app, 'surplus');

    const emptyRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/surplus')
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(emptyRes.body);
    expect((emptyRes.body as { data: unknown[] }).data).toEqual([]);

    const { linkId } = await seedDonorLink(app, ctx);
    await seedLinkedDonor(app, ctx, linkId);

    const recomputeRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/surplus/recompute')
      .set(ctx.authHeaders)
      .expect(201);
    expectSuccessEnvelope(recomputeRes.body);
    const recomputed = (recomputeRes.body as { data: unknown[] }).data;
    expect(recomputed.length).toBeGreaterThanOrEqual(1);
    expectSurplusEntry(recomputed[0]);

    const surplusRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/surplus')
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(surplusRes.body);
    expect(
      (surplusRes.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);

    const calendarRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/surplus/expiry-calendar')
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(calendarRes.body);
    expect(
      (calendarRes.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);
  });
});
