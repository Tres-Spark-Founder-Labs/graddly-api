import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { IlrSubmissionStatus } from '../src/ilr/enums/ilr-submission-status.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { seedIlrOrgContext } from './helpers/ilr-seed.js';
import { processIlrSubmitJobInApp } from './helpers/process-ilr-submit-job.js';

import type { App } from 'supertest/types';

type IlrRecordBody = {
  id: string;
};

type IlrSubmissionBody = {
  id: string;
  status: IlrSubmissionStatus;
  esfaReference: string | null;
  receipt: Record<string, unknown> | null;
};

describe('ILR Submissions (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET :id returns submission receipt after submit', async () => {
    const suffix = Date.now();
    const { owner, orgId, enrolmentId } = await seedIlrOrgContext(app, suffix);

    const buildRes = await request(app.getHttpServer())
      .post('/api/v1/ilr/learner-records/build')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        collectionPeriod: '2025-11',
        academicYear: '2025-26',
      })
      .expect(201);
    const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    const submitRes = await request(app.getHttpServer())
      .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    expectSuccessEnvelope(submitRes.body);
    const queued = (submitRes.body as { data: IlrSubmissionBody }).data;
    expect(queued.status).toBe(IlrSubmissionStatus.QUEUED);

    await processIlrSubmitJobInApp(app, {
      submissionId: queued.id,
      organisationId: orgId,
      requestedByUserId: owner.userId,
    });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/ilr/submissions/${queued.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    const fetched = (getRes.body as { data: IlrSubmissionBody }).data;
    expect(fetched.id).toBe(queued.id);
    expect(fetched.status).toBe(IlrSubmissionStatus.SUBMITTED);
    expect(fetched.esfaReference).toMatch(/^NOOP-/);
    expect(fetched.receipt).toEqual(
      expect.objectContaining({ provider: 'noop' }),
    );
  });
});
