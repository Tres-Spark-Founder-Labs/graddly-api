import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
  expectValidationErrorBody,
} from '../helpers/e2e-response-contracts.js';
import { expectRecipientProfileResource } from '../helpers/levy-exchange-contracts.js';
import { createLexOrgContext } from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange recipient profile (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('upserts and retrieves recipient profile', async () => {
    const ctx = await createLexOrgContext(app, 'recipient-profile');

    const upsertRes = await request(app.getHttpServer())
      .put('/api/v1/levy-exchange/recipient-profile')
      .set(ctx.authHeaders)
      .send({
        sector: 'construction',
        region: 'north_west',
        employeeCountBand: '10_49',
        programmeType: 'standards',
        transferAmountRequired: '15000.00',
        hasDasAccount: true,
      })
      .expect(200);

    expectSuccessEnvelope(upsertRes.body);
    expectRecipientProfileResource((upsertRes.body as { data: unknown }).data);
    expect((upsertRes.body as { data: { sector: string } }).data.sector).toBe(
      'construction',
    );

    const getRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/recipient-profile')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    expectRecipientProfileResource((getRes.body as { data: unknown }).data);
  });

  it('returns 404 when profile does not exist', async () => {
    const ctx = await createLexOrgContext(app, 'recipient-profile-missing');
    const res = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/recipient-profile')
      .set(ctx.authHeaders)
      .expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: 'Recipient profile not found',
      path: '/api/v1/levy-exchange/recipient-profile',
      error: 'Not Found',
    });
  });

  it('returns 422 for invalid payload', async () => {
    const ctx = await createLexOrgContext(app, 'recipient-profile-validation');
    const res = await request(app.getHttpServer())
      .put('/api/v1/levy-exchange/recipient-profile')
      .set(ctx.authHeaders)
      .send({ sector: 'construction' })
      .expect(422);

    expectValidationErrorBody(
      res.body as Record<string, unknown>,
      '/api/v1/levy-exchange/recipient-profile',
    );
  });
});
