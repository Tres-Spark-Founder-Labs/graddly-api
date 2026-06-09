import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { LevyMatchApplicationStatus } from '../../src/levy-exchange/enums/levy-match-application-status.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import { expectMatchApplicationResource } from '../helpers/levy-exchange-contracts.js';
import {
  createLexOrgContext,
  seedConfirmedMatch,
  seedDonorLink,
  seedLinkedDonor,
  seedRecipientProfile,
  seedTransferPreferences,
} from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange match applications (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, lists, confirms, and rejects match applications', async () => {
    const donorCtx = await createLexOrgContext(app, 'match-apps-donor');
    const recipientCtx = await createLexOrgContext(app, 'match-apps-recipient');

    const { linkId } = await seedDonorLink(app, donorCtx);
    await seedLinkedDonor(app, donorCtx, linkId);
    await seedTransferPreferences(app, donorCtx);
    await seedRecipientProfile(app, recipientCtx);

    await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/surplus/recompute')
      .set(donorCtx.authHeaders)
      .expect(201);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/match-applications')
      .set(recipientCtx.authHeaders)
      .send({
        donorOrganisationId: donorCtx.orgId,
        requestedAmount: '15000.00',
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    expectMatchApplicationResource((createRes.body as { data: unknown }).data);
    const applicationId = (createRes.body as { data: { id: string } }).data.id;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/match-applications')
      .query({ role: 'donor', page: 1, perPage: 10 })
      .set(donorCtx.authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    expect(
      (listRes.body as { data: { id: string }[] }).data.some(
        (row) => row.id === applicationId,
      ),
    ).toBe(true);

    const confirmRes = await request(app.getHttpServer())
      .patch(`/api/v1/levy-exchange/match-applications/${applicationId}`)
      .set(donorCtx.authHeaders)
      .send({ status: LevyMatchApplicationStatus.CONFIRMED })
      .expect(200);

    expectSuccessEnvelope(confirmRes.body);
    expect((confirmRes.body as { data: { status: string } }).data.status).toBe(
      LevyMatchApplicationStatus.CONFIRMED,
    );
  });

  it('returns 400 when recipient tries to confirm application', async () => {
    const donorCtx = await createLexOrgContext(
      app,
      'match-apps-forbidden-donor',
    );
    const recipientCtx = await createLexOrgContext(
      app,
      'match-apps-forbidden-recipient',
    );

    const { linkId } = await seedDonorLink(app, donorCtx);
    await seedLinkedDonor(app, donorCtx, linkId);
    await seedTransferPreferences(app, donorCtx);
    await seedRecipientProfile(app, recipientCtx);

    await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/surplus/recompute')
      .set(donorCtx.authHeaders)
      .expect(201);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/match-applications')
      .set(recipientCtx.authHeaders)
      .send({
        donorOrganisationId: donorCtx.orgId,
        requestedAmount: '15000.00',
      })
      .expect(201);

    const applicationId = (createRes.body as { data: { id: string } }).data.id;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/levy-exchange/match-applications/${applicationId}`)
      .set(recipientCtx.authHeaders)
      .send({ status: LevyMatchApplicationStatus.CONFIRMED })
      .expect(403);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 403,
      message: 'Only the donor organisation can confirm or reject applications',
      path: `/api/v1/levy-exchange/match-applications/${applicationId}`,
      error: 'Forbidden',
    });
  });

  it('supports reject workflow on confirmed match seed helper', async () => {
    const donorCtx = await createLexOrgContext(app, 'match-apps-reject-donor');
    const recipientCtx = await createLexOrgContext(
      app,
      'match-apps-reject-recipient',
    );
    const { matchApplicationId } = await seedConfirmedMatch(
      app,
      donorCtx,
      recipientCtx,
    );

    const rejectRes = await request(app.getHttpServer())
      .patch(`/api/v1/levy-exchange/match-applications/${matchApplicationId}`)
      .set(donorCtx.authHeaders)
      .send({ status: LevyMatchApplicationStatus.REJECTED })
      .expect(400);

    expectFilteredHttpExceptionBody(rejectRes.body as Record<string, unknown>, {
      statusCode: 400,
      message: 'Only pending applications can be updated',
      path: `/api/v1/levy-exchange/match-applications/${matchApplicationId}`,
      error: 'Bad Request',
    });
  });
});
