import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { CompletionPushStatus } from '../src/completion-push/enums/completion-push-status.enum.js';
import { DasHttpClient } from '../src/das/das-http.client.js';
import { EnrolmentPushStatus } from '../src/enrolment-push/enums/enrolment-push-status.enum.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';
import { EpaOutcome } from '../src/enrolments/enums/epa-outcome.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { seedIlrOrgContext } from './helpers/ilr-seed.js';
import { processCompletionPushJobInApp } from './helpers/process-completion-push-job.js';
import { processEnrolmentPushJobInApp } from './helpers/process-enrolment-push-job.js';
import {
  createEnrolment,
  createOrgOwnerContext,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { App } from 'supertest/types';

describe('DAS outbound push (e2e)', () => {
  let app: INestApplication<App>;
  let dasClient: DasHttpClient;

  beforeAll(async () => {
    app = await createE2eApp();
    dasClient = app.get(DasHttpClient);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues enrolment push on ILR build and delivers via worker', async () => {
    const suffix = Date.now();
    const { owner, orgId, enrolmentId } = await seedIlrOrgContext(app, suffix);

    const buildRes = await request(app.getHttpServer())
      .post('/api/v1/ilr/learner-records/build')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        collectionPeriod: '2025-10',
        academicYear: '2025-26',
      })
      .expect(201);

    const pg = createE2ePgClient();
    await pg.connect();
    let pushId = '';
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const row = await pg.query<{ id: string; status: string }>(
        `SELECT id, status FROM enrolment_submission_pushes
         WHERE "organisationId" = $1 AND "enrolmentId" = $2 AND trigger = 'ilr_created'
         LIMIT 1`,
        [orgId, enrolmentId],
      );
      pushId = row.rows[0]?.id ?? '';
      expect(row.rows[0]?.status).toBe(EnrolmentPushStatus.QUEUED);
    } finally {
      await pg.end();
    }
    expect(pushId).toBeTruthy();

    jest.spyOn(dasClient, 'submitEnrolment').mockResolvedValueOnce({
      reference: 'DAS-ENR-E2E',
      status: 'accepted',
      raw: {},
    });

    await processEnrolmentPushJobInApp(app, {
      pushId,
      organisationId: orgId,
      requestedByUserId: owner.userId,
    });

    const pollRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolment-pushes/${pushId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(pollRes.body);
    expect((pollRes.body as { data: { status: string } }).data.status).toBe(
      EnrolmentPushStatus.DELIVERED,
    );
    expect(
      (pollRes.body as { data: { dasReference: string } }).data.dasReference,
    ).toBe('DAS-ENR-E2E');

    expect(buildRes.body).toBeDefined();
  });

  it('queues completion push on enrolment complete and EPA outcome', async () => {
    const { authHeaders, orgId, owner } = await createOrgOwnerContext(
      app,
      'DAS Completion Push',
    );
    const { standardId, apprenticeId } = await seedProgrammeGraph(
      app,
      authHeaders,
    );
    const enrolmentId = await createEnrolment(
      app,
      authHeaders,
      apprenticeId,
      standardId,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(authHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/complete`)
      .set(authHeaders)
      .expect(201);

    const pg = createE2ePgClient();
    await pg.connect();
    let completionPushId = '';
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const row = await pg.query<{ id: string }>(
        `SELECT id FROM enrolment_completion_pushes
         WHERE "enrolmentId" = $1 AND trigger = 'enrolment_completed' LIMIT 1`,
        [enrolmentId],
      );
      completionPushId = row.rows[0]?.id ?? '';
    } finally {
      await pg.end();
    }
    expect(completionPushId).toBeTruthy();

    jest.spyOn(dasClient, 'notifyCompletion').mockResolvedValueOnce({
      reference: 'DAS-CMP-E2E',
      status: 'accepted',
      raw: {},
    });

    await processCompletionPushJobInApp(app, {
      pushId: completionPushId,
      organisationId: orgId,
      requestedByUserId: owner.userId,
    });

    const epaRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/epa-outcome`)
      .set(authHeaders)
      .send({ outcome: EpaOutcome.PASS, assessedOn: '2026-06-01' })
      .expect(201);
    expectSuccessEnvelope(epaRes.body);

    const pg2 = createE2ePgClient();
    await pg2.connect();
    let epaPushId = '';
    try {
      await pg2.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const row = await pg2.query<{ id: string }>(
        `SELECT id FROM enrolment_completion_pushes
         WHERE "enrolmentId" = $1 AND trigger = 'epa_outcome_recorded' LIMIT 1`,
        [enrolmentId],
      );
      epaPushId = row.rows[0]?.id ?? '';
    } finally {
      await pg2.end();
    }
    expect(epaPushId).toBeTruthy();

    jest.spyOn(dasClient, 'notifyCompletion').mockResolvedValueOnce({
      reference: 'DAS-CMP-EPA',
      status: 'accepted',
      raw: {},
    });

    await processCompletionPushJobInApp(app, {
      pushId: epaPushId,
      organisationId: orgId,
      requestedByUserId: owner.userId,
    });

    const pollRes = await request(app.getHttpServer())
      .get(`/api/v1/completion-pushes/${epaPushId}`)
      .set(authHeaders)
      .expect(200);

    expect(
      (pollRes.body as { data: { status: CompletionPushStatus } }).data.status,
    ).toBe(CompletionPushStatus.DELIVERED);

    const enrolmentRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set(authHeaders)
      .expect(200);
    expect(
      (enrolmentRes.body as { data: { status: EnrolmentStatus } }).data.status,
    ).toBe(EnrolmentStatus.COMPLETED);
  });
});
