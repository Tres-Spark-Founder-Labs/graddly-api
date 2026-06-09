import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DasDonorLinkStatus } from '../../src/levy-exchange/enums/das-donor-link-status.enum.js';
import { DasDonorLinkService } from '../../src/levy-exchange/services/das-donor-link.service.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import { expectDonorLinkResource } from '../helpers/levy-exchange-contracts.js';
import {
  createLexOrgContext,
  seedDonorLink,
} from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange donor OAuth (e2e)', () => {
  let app: INestApplication<App>;
  const originalFlowUrl = process.env.FRONTEND_BASE_FLOW_URL;

  beforeAll(async () => {
    delete process.env.FRONTEND_BASE_FLOW_URL;
    app = await createE2eApp();
  });

  afterAll(async () => {
    if (originalFlowUrl === undefined) {
      delete process.env.FRONTEND_BASE_FLOW_URL;
    } else {
      process.env.FRONTEND_BASE_FLOW_URL = originalFlowUrl;
    }
    await app.close();
  });

  it('returns 401 when OAuth callback parameters are missing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/donor-links/oauth/callback')
      .expect(401);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 401,
      message: 'Missing OAuth callback parameters',
      path: '/api/v1/levy-exchange/donor-links/oauth/callback',
      error: 'Unauthorized',
    });
  });

  it('completes OAuth callback with JSON response when no frontend redirect', async () => {
    const ctx = await createLexOrgContext(app, 'donor-oauth');
    const { linkId } = await seedDonorLink(app, ctx);

    const donorLinkService = app.get(DasDonorLinkService);
    jest.spyOn(donorLinkService, 'completeOAuthCallback').mockResolvedValue({
      id: linkId,
      organisationId: ctx.orgId,
      label: 'HQ',
      dasAccountId: 'das-1',
      ukprn: '12345678',
      status: DasDonorLinkStatus.LINKED,
      lastErrorMessage: null,
      consentedAt: new Date().toISOString(),
      lastSyncedAt: null,
      lastBalance: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/donor-links/oauth/callback')
      .query({ code: 'auth-code', state: 'signed-state' })
      .expect(200);

    expectSuccessEnvelope(res.body);
    expectDonorLinkResource((res.body as { data: unknown }).data);
    expect((res.body as { data: { status: string } }).data.status).toBe(
      DasDonorLinkStatus.LINKED,
    );
  });
});
