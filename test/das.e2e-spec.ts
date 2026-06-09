import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { DasHttpClient } from '../src/das/das-http.client.js';
import { DasLevySyncService } from '../src/das/das-levy-sync.service.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

describe('DASController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('queues manual sync and returns persisted levy status', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `das-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Das Org ${suffix}`))
      .expect(201);
    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const queueRes = await request(app.getHttpServer())
      .post('/api/v1/das/sync')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, organisationId)
      .expect(201);
    expectSuccessEnvelope(queueRes.body);
    expect(
      (queueRes.body as { data: { jobId: string; status: string } }).data
        .status,
    ).toBe('queued');

    const client = app.get(DasHttpClient);
    jest.spyOn(client, 'fetchLevyBalance').mockResolvedValue({
      accountId: 'das-account-1',
      balance: '321.50',
      currency: 'GBP',
      raw: { accountId: 'das-account-1', balance: 321.5, currency: 'GBP' },
    });

    const syncService = app.get(DasLevySyncService);
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(owner.userId);
    setLastKnownUserIdForGuc(owner.userId);
    await syncService.syncOrganisation(organisationId, owner.userId);
    await syncService.syncOrganisation(organisationId, owner.userId);

    const balanceRes = await request(app.getHttpServer())
      .get('/api/v1/das/levy-balance')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, organisationId)
      .expect(200);
    expectSuccessEnvelope(balanceRes.body);
    const balance = (
      balanceRes.body as {
        data: {
          balance: string | null;
          currency: string | null;
          lastSyncedAt: string | null;
        };
      }
    ).data;
    expect(balance.balance).toBe('321.50');
    expect(balance.currency).toBe('GBP');
    expect(balance.lastSyncedAt).toEqual(expect.any(String));

    const auditRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'das_levy_balances' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, organisationId)
      .expect(200);
    expectSuccessEnvelope(auditRes.body);
    const rows = (
      auditRes.body as {
        data: Array<{ action: AuditAction; entityType: string }>;
      }
    ).data;
    expect(rows.some((row) => row.action === AuditAction.INSERT)).toBe(true);
    expect(rows.some((row) => row.action === AuditAction.UPDATE)).toBe(true);

    const forecastRes = await request(app.getHttpServer())
      .get('/api/v1/das/levy-forecast')
      .query({ horizonMonths: 12 })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, organisationId)
      .expect(200);
    expectSuccessEnvelope(forecastRes.body);
    expect(forecastRes.body.data).toEqual(
      expect.objectContaining({
        organisationId,
        horizonMonths: 12,
        activeEnrolmentCount: expect.any(Number),
        projectedMonthlySpend: expect.any(Number),
        projectedCompletionLiability: expect.any(Number),
        latestLevyBalance: 321.5,
      }),
    );
  });
});
