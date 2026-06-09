import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { createOrgOwnerContext } from './helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('Apprentices (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, retrieves, lists, updates, and deletes apprentices', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(app, 'Apprentices Org');
    const apprenticeEmail = `apprentice-${suffix}@example.com`;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set(authHeaders)
      .send({
        firstName: 'Ap',
        lastName: 'Prentice',
        email: apprenticeEmail,
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const apprenticeId = (createRes.body as { data: { id: string } }).data.id;

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/apprentices/${apprenticeId}`)
      .set(authHeaders)
      .expect(200);

    expectSuccessEnvelope(getRes.body);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/apprentices')
      .query({ page: 1, perPage: 10 })
      .set(authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/apprentices/${apprenticeId}`)
      .set(authHeaders)
      .send({ firstName: 'Ap Updated' })
      .expect(200);

    expectSuccessEnvelope(updateRes.body);

    await request(app.getHttpServer())
      .delete(`/api/v1/apprentices/${apprenticeId}`)
      .set(authHeaders)
      .expect(204);
  });
});
