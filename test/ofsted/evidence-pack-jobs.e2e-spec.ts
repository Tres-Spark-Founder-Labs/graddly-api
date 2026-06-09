import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { EvidencePackJobStatus } from '../../src/ofsted/enums/evidence-pack-job-status.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser, loginVerifiedUser } from '../helpers/e2e-http.js';
import { buildOrgPayload } from '../helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { processEvidencePackJobInApp } from '../helpers/process-evidence-pack-job.js';

import type { App } from 'supertest/types';

describe('Ofsted evidence pack jobs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and completes an evidence pack job', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `ofsted-pack-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Ofsted Pack Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );
    const ownerUserId = owner.userId;

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
