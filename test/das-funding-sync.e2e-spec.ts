import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DAS_CLIENT } from '../src/das/das-client.constants.js';
import { DasFundingSyncService } from '../src/das/das-funding-sync.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
  successData,
} from './helpers/e2e-response-contracts.js';
import { createEmployerReportingContext } from './helpers/reporting-e2e.js';
import { enterTenantContext } from './helpers/tenant-context.js';

import type { IDasClient } from '../src/das/interfaces/das.client.interface.js';
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

    // The client the app resolved (DAS_CLIENT), not DasHttpClient: this suite
    // tests what consumes the DAS figures, so it passes under either client.
    const client = app.get<IDasClient>(DAS_CLIENT);
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
    enterTenantContext({
      label: 'e2e:das-funding-sync',
      organisationId: ctx.employerOrgId,
      userId: ctx.owner.userId,
    });
    const syncedCount = await fundingSync.syncOrganisation(
      ctx.employerOrgId,
      ctx.owner.userId,
    );
    expect(syncedCount).toBe(2);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/das/funding-payments')
      .set(ctx.authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(successData<unknown[]>(listRes.body).length).toBeGreaterThanOrEqual(
      2,
    );
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
    expect(
      successData<{ fundingSummary: unknown }>(roiRes.body).fundingSummary,
    ).toEqual(
      expect.objectContaining({
        totalReceived: 3000,
        lastPaymentDate: '2026-02-01',
        pendingClawbackCount: 1,
        currency: 'GBP',
      }),
    );
  });
});
