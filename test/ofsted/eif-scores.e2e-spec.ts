import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ProgrammeDocumentType } from '../../src/ofsted/enums/programme-document-type.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser, loginVerifiedUser } from '../helpers/e2e-http.js';
import { buildOrgPayload } from '../helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { authHeadersFor } from '../helpers/programme-graph-e2e.js';

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

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...buildOrgPayload(`Ofsted EIF Org ${suffix}`),
        portalType: 'provider',
      })
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );
    const headers = authHeadersFor(ownerToken, orgId);

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set(headers)
      .send({
        code: `EIF-PROG-${suffix}`,
        title: 'EIF Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/programmes/${programmeId}/documents`)
      .set(headers)
      .send({
        documentType: ProgrammeDocumentType.CURRICULUM_MAP,
        storageKey: `orgs/${orgId}/programmes/${programmeId}/curriculum.pdf`,
      })
      .expect(201);

    const checklistRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/safeguarding-checklist')
      .set(headers)
      .expect(200);
    expectSuccessEnvelope(checklistRes.body);

    await request(app.getHttpServer())
      .patch('/api/v1/ofsted/safeguarding-checklist/policy_published')
      .set(headers)
      .send({})
      .expect(200);

    const criteriaRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-criteria')
      .set(headers)
      .expect(200);

    expectSuccessEnvelope(criteriaRes.body);
    const criteria = (criteriaRes.body as { data: { slug: string }[] }).data;
    expect(criteria).toHaveLength(7);

    const scoresRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-scores')
      .set(headers)
      .expect(200);

    expectSuccessEnvelope(scoresRes.body);
    const scores = (
      scoresRes.body as {
        data: {
          overallPercent: number;
          criteria: { slug: string; percent: number }[];
          cached: boolean;
        };
      }
    ).data;
    expect(scores.criteria).toHaveLength(7);
    expect(typeof scores.overallPercent).toBe('number');
    expect(scores.cached).toBe(false);

    const safeguarding = scores.criteria.find((c) => c.slug === 'safeguarding');
    const curriculum = scores.criteria.find(
      (c) => c.slug === 'curriculum_intent',
    );
    expect(safeguarding?.percent).not.toBe(70);
    expect(curriculum?.percent).toBeGreaterThan(0);
  });
});
