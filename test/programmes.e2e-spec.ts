import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { createOrgOwnerContext } from './helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('Programmes (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, retrieves, lists, updates, and deletes programmes', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(app, 'Programmes Org');
    const programmeCode = `PROG-${suffix}`;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set(authHeaders)
      .send({
        code: programmeCode,
        title: 'Programme One',
        status: 'active',
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const programmeId = (createRes.body as { data: { id: string } }).data.id;
    expect((createRes.body as { data: { code: string } }).data.code).toBe(
      programmeCode,
    );

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/programmes/${programmeId}`)
      .set(authHeaders)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { id: string } }).data.id).toBe(programmeId);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/programmes')
      .query({ page: 1, perPage: 10 })
      .set(authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    expect(
      (
        listRes.body as {
          data: Array<{ id: string }>;
          meta: { total: number; page: number; perPage: number };
        }
      ).meta,
    ).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        page: 1,
        perPage: 10,
      }),
    );

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/programmes/${programmeId}`)
      .set(authHeaders)
      .send({ title: 'Programme One Updated' })
      .expect(200);

    expectSuccessEnvelope(updateRes.body);
    expect((updateRes.body as { data: { title: string } }).data.title).toBe(
      'Programme One Updated',
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/programmes/${programmeId}`)
      .set(authHeaders)
      .expect(204);
  });
});
