import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { DasFundingSyncService } from '../src/das/das-funding-sync.service.js';
import { DasHttpClient } from '../src/das/das-http.client.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { createEmployerReportingContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('DAS funding sync (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists funding payments and exposes them via list + levy ROI summary', async () => {
    const ctx = await createEmployerReportingContext(app, 'funding-sync');

    const client = app.get(DasHttpClient);
    jest.spyOn(client, 'fetchFundingPayments').mockResolvedValue([
      {
        externalReference: 'fp-e2e-1',
        paymentDate: '2026-01-20',
        amount: '2500.00',
        currency: 'GBP',
        fundingPeriod: '2025-26',
        clawbackNotice: null,
        learnerRef: null,
        raw: { reference: 'fp-e2e-1' },
      },
      {
        externalReference: 'fp-e2e-2',
        paymentDate: '2026-02-01',
        amount: '500.00',
        currency: 'GBP',
        fundingPeriod: '2025-26',
        clawbackNotice: 'Clawback under review',
        learnerRef: null,
        raw: { reference: 'fp-e2e-2' },
      },
    ]);

    const fundingSync = app.get(DasFundingSyncService);
    setCurrentOrganisationId(ctx.employerOrgId);
    setCurrentUserId(ctx.owner.userId);
    setLastKnownUserIdForGuc(ctx.owner.userId);
    const syncedCount = await fundingSync.syncOrganisation(
      ctx.employerOrgId,
      ctx.owner.userId,
    );
    expect(syncedCount).toBe(2);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/das/funding-payments')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(listRes.body);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
    expect(listRes.body.meta).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        page: expect.any(Number),
        perPage: expect.any(Number),
      }),
    );

    const roiRes = await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-roi')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(roiRes.body);
    expect(roiRes.body.data.fundingSummary).toEqual(
      expect.objectContaining({
        totalReceived: 3000,
        lastPaymentDate: '2026-02-01',
        pendingClawbackCount: 1,
        currency: 'GBP',
      }),
    );
  });
});
