import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../src/common/context/correlation-id-context.js';
import { DasHttpClient } from '../../src/das/das-http.client.js';
import { DasLevySyncService } from '../../src/das/das-levy-sync.service.js';
import { setLastKnownUserIdForGuc } from '../../src/database/apply-tenant-gucs.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  createEmployerReportingContext,
  createProviderDirectoryContext,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('LevyUtilisationController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /reporting/levy-utilisation returns series after levy sync', async () => {
    const ctx = await createEmployerReportingContext(app, 'utilisation');

    const client = app.get(DasHttpClient);
    jest.spyOn(client, 'fetchLevyBalance').mockResolvedValue({
      accountId: 'das-account-1',
      balance: '5000.00',
      currency: 'GBP',
      raw: {
        monthlyContributions: [
          { month: '2025-11', amount: 1500 },
          { month: '2025-12', amount: 1600 },
        ],
        transactions: [
          { month: '2025-11', spend: 400 },
          { month: '2025-12', spend: 500 },
        ],
        used: 1000,
        expiringWithin90Days: 250,
        available: 5000,
      },
    });

    const syncService = app.get(DasLevySyncService);
    setCurrentOrganisationId(ctx.employerOrgId);
    setCurrentUserId(ctx.owner.userId);
    setLastKnownUserIdForGuc(ctx.owner.userId);
    await syncService.syncOrganisation(ctx.employerOrgId, ctx.owner.userId);

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-utilisation')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        organisationId: ctx.employerOrgId,
        segments: expect.objectContaining({
          used: 1000,
          expiringWithin90Days: 250,
          available: 5000,
          currency: 'GBP',
        }),
        monthlySeries: expect.arrayContaining([
          expect.objectContaining({
            month: '2025-11',
            contributions: 1500,
            spend: 400,
          }),
        ]),
        forecast: expect.objectContaining({
          projectedMonthlySpend: expect.any(Number),
        }),
        costPerApprentice: expect.any(Array),
        generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      }),
    );
  });

  it('returns 403 when active org is a provider portal', async () => {
    const ctx = await createProviderDirectoryContext(app, 'util-forbidden');

    await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-utilisation')
      .set(ctx.authHeaders)
      .expect(403);
  });
});
