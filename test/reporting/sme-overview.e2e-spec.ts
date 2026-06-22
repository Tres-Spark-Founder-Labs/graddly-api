import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  createEmployerReportingContext,
  createFlowSmeContext,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('SmeOverviewController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /reporting/sme-overview returns aggregate for Flow org', async () => {
    const ctx = await createFlowSmeContext(app, 'overview');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/sme-overview')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          activeApprenticeCount: expect.any(Number),
          pendingOtjApprovalCount: expect.any(Number),
          reviewsDueThisMonthCount: expect.any(Number),
          commitmentPipeline: expect.objectContaining({
            none: expect.any(Number),
            draft: expect.any(Number),
            awaitingSignatures: expect.any(Number),
            signed: expect.any(Number),
            cancelled: expect.any(Number),
          }),
        }),
        pendingOtjApprovals: expect.any(Array),
        apprentices: expect.any(Array),
      }),
    );
    expect(res.body.data.summary.activeApprenticeCount).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('returns 403 when active org is not a Flow portal', async () => {
    const ctx = await createEmployerReportingContext(app, 'sme-forbidden');

    await request(app.getHttpServer())
      .get('/api/v1/reporting/sme-overview')
      .set(ctx.authHeaders)
      .expect(403);
  });
});
