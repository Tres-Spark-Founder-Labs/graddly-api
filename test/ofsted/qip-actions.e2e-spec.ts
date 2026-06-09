import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { QipActionStatus } from '../../src/ofsted/enums/qip-action-status.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser, loginVerifiedUser } from '../helpers/e2e-http.js';
import { buildOrgPayload } from '../helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

describe('Ofsted QIP actions (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports QIP CRUD and summary', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `ofsted-qip-${suffix}@example.com`,
    });

    await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Ofsted QIP Org ${suffix}`))
      .expect(201);

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );
    const ownerUserId = owner.userId;

    const criteriaRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-criteria')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const criteria = (criteriaRes.body as { data: { slug: string }[] }).data;

    const createQipRes = await request(app.getHttpServer())
      .post('/api/v1/qip-actions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Improve safeguarding records',
        assignedOwnerUserId: ownerUserId,
        targetCompletionDate: '2026-12-31',
        eifCriterionSlug: criteria[0].slug,
        status: QipActionStatus.NOT_STARTED,
      })
      .expect(201);

    expectSuccessEnvelope(createQipRes.body);
    const qipId = (createQipRes.body as { data: { id: string } }).data.id;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/qip-actions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    expect((listRes.body as { data: unknown[] }).data).toHaveLength(1);

    const summaryRes = await request(app.getHttpServer())
      .get('/api/v1/qip-actions/summary')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(summaryRes.body);
    expect((summaryRes.body as { data: { total: number } }).data.total).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/qip-actions/${qipId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: QipActionStatus.COMPLETED })
      .expect(200);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/qip-actions/${qipId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { id: string } }).data.id).toBe(qipId);

    await request(app.getHttpServer())
      .delete(`/api/v1/qip-actions/${qipId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
  });
});
