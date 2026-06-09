import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DasDonorLinkStatus } from '../../src/levy-exchange/enums/das-donor-link-status.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
  expectValidationErrorBody,
} from '../helpers/e2e-response-contracts.js';
import { expectDonorLinkResource } from '../helpers/levy-exchange-contracts.js';
import {
  createLexOrgContext,
  mockDasForLevyExchange,
  seedLinkedDonor,
} from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange donor links (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, lists, gets, starts consent, syncs, and deletes donor links', async () => {
    mockDasForLevyExchange(app);
    const ctx = await createLexOrgContext(app, 'donor-links');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/donor-links')
      .set(ctx.authHeaders)
      .send({ label: 'HQ', ukprn: '12345678' })
      .expect(201);
    expectSuccessEnvelope(createRes.body);
    expectDonorLinkResource((createRes.body as { data: unknown }).data);
    const linkId = (createRes.body as { data: { id: string } }).data.id;
    expect((createRes.body as { data: { status: string } }).data.status).toBe(
      DasDonorLinkStatus.PENDING_CONSENT,
    );

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/donor-links')
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(listRes.body);
    expect(
      (listRes.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/levy-exchange/donor-links/${linkId}`)
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(getRes.body);
    expectDonorLinkResource((getRes.body as { data: unknown }).data);

    const consentRes = await request(app.getHttpServer())
      .get(`/api/v1/levy-exchange/donor-links/${linkId}/consent/start`)
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(consentRes.body);
    expect(
      (consentRes.body as { data: { authorizeUrl: string } }).data.authorizeUrl,
    ).toContain('http');

    await seedLinkedDonor(app, ctx, linkId);

    const syncRes = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/donor-links/${linkId}/sync`)
      .set(ctx.authHeaders)
      .expect(201);
    expectSuccessEnvelope(syncRes.body);
    expectDonorLinkResource((syncRes.body as { data: unknown }).data);

    await request(app.getHttpServer())
      .delete(`/api/v1/levy-exchange/donor-links/${linkId}`)
      .set(ctx.authHeaders)
      .expect(204);
  });

  it('returns 404 for missing donor link', async () => {
    const ctx = await createLexOrgContext(app, 'donor-links-missing');
    const res = await request(app.getHttpServer())
      .get(
        '/api/v1/levy-exchange/donor-links/00000000-0000-4000-8000-000000000001',
      )
      .set(ctx.authHeaders)
      .expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: 'Donor link not found',
      path: '/api/v1/levy-exchange/donor-links/00000000-0000-4000-8000-000000000001',
      error: 'Not Found',
    });
  });

  it('returns 422 for invalid create payload', async () => {
    const ctx = await createLexOrgContext(app, 'donor-links-validation');
    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/donor-links')
      .set(ctx.authHeaders)
      .send({ label: 'x'.repeat(200) })
      .expect(422);

    expectValidationErrorBody(
      res.body as Record<string, unknown>,
      '/api/v1/levy-exchange/donor-links',
    );
  });
});
