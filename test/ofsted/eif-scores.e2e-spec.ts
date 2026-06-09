import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser, loginVerifiedUser } from '../helpers/e2e-http.js';
import { buildOrgPayload } from '../helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

describe('Ofsted EIF scores (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns EIF criteria and scores', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `ofsted-eif-${suffix}@example.com`,
    });

    await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Ofsted EIF Org ${suffix}`))
      .expect(201);

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );

    const criteriaRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-criteria')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(criteriaRes.body);
    const criteria = (criteriaRes.body as { data: { slug: string }[] }).data;
    expect(criteria).toHaveLength(7);

    const scoresRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-scores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(scoresRes.body);
    const scores = (
      scoresRes.body as {
        data: {
          overallPercent: number;
          criteria: unknown[];
          cached: boolean;
        };
      }
    ).data;
    expect(scores.criteria).toHaveLength(7);
    expect(typeof scores.overallPercent).toBe('number');
    expect(scores.cached).toBe(false);
  });
});
