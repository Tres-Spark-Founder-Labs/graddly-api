import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import {
  createOrgOwnerContext,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('Standards (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, retrieves, lists, updates, and deletes standards', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(app, 'Standards Org');
    const { programmeId } = await seedProgrammeGraph(app, authHeaders, {
      suffix,
    });
    const standardCode = `STD-ALT-${suffix}`;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set(authHeaders)
      .send({
        programmeId,
        code: standardCode,
        title: 'Standard One',
        status: 'active',
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const standardId = (createRes.body as { data: { id: string } }).data.id;

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/standards/${standardId}`)
      .set(authHeaders)
      .expect(200);

    expectSuccessEnvelope(getRes.body);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/standards')
      .query({ page: 1, perPage: 10 })
      .set(authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/standards/${standardId}`)
      .set(authHeaders)
      .send({ title: 'Standard One Updated' })
      .expect(200);

    expectSuccessEnvelope(updateRes.body);

    await request(app.getHttpServer())
      .delete(`/api/v1/standards/${standardId}`)
      .set(authHeaders)
      .expect(204);
  });
});
