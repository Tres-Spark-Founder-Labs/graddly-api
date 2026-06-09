import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { EvidencePackJobStatus } from '../src/ofsted/enums/evidence-pack-job-status.enum.js';
import { QipActionStatus } from '../src/ofsted/enums/qip-action-status.enum.js';

import { createVerifiedUser, loginVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { processEvidencePackJobInApp } from './helpers/process-evidence-pack-job.js';

describe('OfstedController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns EIF criteria and scores, QIP CRUD + summary, and evidence pack job', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `ofsted-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Ofsted Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

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

    const createPackRes = await request(app.getHttpServer())
      .post('/api/v1/ofsted/evidence-packs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    expectSuccessEnvelope(createPackRes.body);
    const jobId = (createPackRes.body as { data: { jobId: string } }).data
      .jobId;

    await processEvidencePackJobInApp(app, {
      jobId,
      organisationId,
      userId: ownerUserId,
      additionalStorageKeys: [],
    });

    const packStatusRes = await request(app.getHttpServer())
      .get(`/api/v1/ofsted/evidence-packs/${jobId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(packStatusRes.body);
    const pack = (
      packStatusRes.body as {
        data: {
          status: string;
          outputKey: string;
          downloadUrl: string;
        };
      }
    ).data;
    expect(pack.status).toBe(EvidencePackJobStatus.COMPLETED);
    expect(pack.outputKey).toContain('/export/');
    expect(pack.downloadUrl).toBeTruthy();
  });
});
