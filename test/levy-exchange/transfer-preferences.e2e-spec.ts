import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
  expectValidationErrorBody,
} from '../helpers/e2e-response-contracts.js';
import { expectTransferPreferencesResource } from '../helpers/levy-exchange-contracts.js';
import { createLexOrgContext } from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange transfer preferences (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('upserts and retrieves transfer preferences', async () => {
    const ctx = await createLexOrgContext(app, 'transfer-preferences');

    const upsertRes = await request(app.getHttpServer())
      .put('/api/v1/levy-exchange/transfer-preferences')
      .set(ctx.authHeaders)
      .send({
        sectors: ['  Construction '],
        regions: ['North West'],
        sizeBands: ['10-49'],
        programmeTypes: ['ST0116   Software developer'],
        maxPerRecipient: '20000.00',
        openMatching: false,
        anonymousMatching: false,
      })
      .expect(200);

    expectSuccessEnvelope(upsertRes.body);
    expectTransferPreferencesResource(
      (upsertRes.body as { data: unknown }).data,
    );
    expect(
      (upsertRes.body as { data: { openMatching: boolean } }).data.openMatching,
    ).toBe(false);
    // Normalised exactly as the recipient's single values are, so equal words
    // on the two sides are equal strings when matching compares them.
    expect(
      (
        upsertRes.body as {
          data: { sectors: string[]; programmeTypes: string[] };
        }
      ).data,
    ).toMatchObject({
      sectors: ['Construction'],
      programmeTypes: ['ST0116 Software developer'],
    });

    const closed = await request(app.getHttpServer())
      .put('/api/v1/levy-exchange/transfer-preferences')
      .set(ctx.authHeaders)
      .send({
        sectors: [],
        regions: ['North West', 'Midlands'],
        sizeBands: ['10_49'],
        programmeTypes: [],
        maxPerRecipient: null,
        openMatching: false,
        anonymousMatching: false,
      })
      .expect(422);
    expect((closed.body as { errors: Record<string, string> }).errors).toEqual({
      regions: expect.stringMatching(
        /^regions must be one of the permitted values: .*North West/,
      ),
      sizeBands:
        'sizeBands must be one of the permitted values: 1-9, 10-49, 50-249, 250+',
    });

    const getRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/transfer-preferences')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    expectTransferPreferencesResource((getRes.body as { data: unknown }).data);
  });

  it('returns 404 when preferences do not exist', async () => {
    const ctx = await createLexOrgContext(app, 'transfer-preferences-missing');
    const res = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/transfer-preferences')
      .set(ctx.authHeaders)
      .expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: 'Transfer preferences not found',
      path: '/api/v1/levy-exchange/transfer-preferences',
      error: 'Not Found',
    });
  });

  it('returns 422 for invalid payload', async () => {
    const ctx = await createLexOrgContext(
      app,
      'transfer-preferences-validation',
    );
    const res = await request(app.getHttpServer())
      .put('/api/v1/levy-exchange/transfer-preferences')
      .set(ctx.authHeaders)
      .send({ sectors: 'not-an-array' })
      .expect(422);

    expectValidationErrorBody(
      res.body as Record<string, unknown>,
      '/api/v1/levy-exchange/transfer-preferences',
    );
  });
});
