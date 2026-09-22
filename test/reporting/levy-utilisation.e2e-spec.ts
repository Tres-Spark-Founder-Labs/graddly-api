import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DAS_CLIENT } from '../../src/das/das-client.constants.js';
import { DasLevySyncService } from '../../src/das/das-levy-sync.service.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  createEmployerReportingContext,
  createProviderDirectoryContext,
} from '../helpers/reporting-e2e.js';
import { enterTenantContext } from '../helpers/tenant-context.js';

import type { IDasClient } from '../../src/das/interfaces/das.client.interface.js';
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

    // The client the app resolved (DAS_CLIENT), not DasHttpClient: this suite
    // tests what consumes the DAS figures, so it passes under either client.
    const client = app.get<IDasClient>(DAS_CLIENT);
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
    enterTenantContext({
      label: 'e2e:levy-utilisation',
      organisationId: ctx.employerOrgId,
      userId: ctx.owner.userId,
    });
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
