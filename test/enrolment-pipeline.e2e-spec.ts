import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { DasHttpClient } from '../src/das/das-http.client.js';
import { EnrolmentPipelineState } from '../src/enrolments/enums/enrolment-pipeline-state.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { ensurePublishedIlrMappingConfig } from './helpers/ilr-seed.js';
import { findInvitationAcceptTokenForInvitationId } from './helpers/invitation-accept-redis.js';
import { processEnrolmentPushJobInApp } from './helpers/process-enrolment-push-job.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { App } from 'supertest/types';

describe('Enrolment pipeline (e2e)', () => {
  let app: INestApplication<App>;
  let dasClient: DasHttpClient;

  beforeAll(async () => {
    app = await createE2eApp();
    dasClient = app.get(DasHttpClient);
    await ensurePublishedIlrMappingConfig();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs invited → account_created → provider_accepted → ilr_created → das_confirmed', async () => {
    const suffix = Date.now();
    const apprenticeEmail = `pipeline-apprentice-${suffix}@example.com`;

    const employer = await createVerifiedUser(app, {
      email: `pipeline-employer-${suffix}@example.com`,
    });
    const employerOrgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .send(buildOrgPayload(`Pipeline Employer ${suffix}`))
      .expect(201);
    const employerOrgId = (employerOrgRes.body as { data: { id: string } }).data
      .id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .send({
        code: `PL-PROG-${suffix}`,
        title: 'Pipeline Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .send({
        programmeId,
        code: `PL-STD-${suffix}`,
        title: 'Pipeline Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .send({
        firstName: 'Pipe',
        lastName: 'Line',
        email: apprenticeEmail,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .send({
        apprenticeId,
        standardId,
        plannedStartDate: '2025-01-15',
        plannedEndDate: '2026-12-31',
      })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    const activateRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .expect(201);

    expectSuccessEnvelope(activateRes.body);
    expect(
      (activateRes.body as { data: { pipelineState: string } }).data
        .pipelineState,
    ).toBe(EnrolmentPipelineState.INVITED);

    const pg = createE2ePgClient();
    await pg.connect();
    let invitationId = '';
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const inv = await pg.query<{ id: string }>(
        `SELECT id FROM invitations
         WHERE "enrolmentId" = $1 AND "isDeleted" = false
         LIMIT 1`,
        [enrolmentId],
      );
      invitationId = inv.rows[0]?.id ?? '';
    } finally {
      await pg.end();
    }
    expect(invitationId).toBeTruthy();

    const apprenticeUser = await createVerifiedUser(app, {
      email: apprenticeEmail,
    });
    const acceptToken =
      await findInvitationAcceptTokenForInvitationId(invitationId);
    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${apprenticeUser.accessToken}`)
      .send({ token: acceptToken })
      .expect(200);

    const afterAcceptRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .expect(200);

    expect(
      (afterAcceptRes.body as { data: { pipelineState: string } }).data
        .pipelineState,
    ).toBe(EnrolmentPipelineState.ACCOUNT_CREATED);
    expect(
      (afterAcceptRes.body as { data: { apprenticeUserId: string } }).data
        .apprenticeUserId,
    ).toBe(apprenticeUser.userId);

    const providerAcceptRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/accept-provider`)
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .expect(201);

    expect(
      (providerAcceptRes.body as { data: { pipelineState: string } }).data
        .pipelineState,
    ).toBe(EnrolmentPipelineState.PROVIDER_ACCEPTED);

    await request(app.getHttpServer())
      .post('/api/v1/ilr/learner-records/build')
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .send({
        enrolmentId,
        collectionPeriod: '2025-10',
        academicYear: '2025-26',
      })
      .expect(201);

    const afterIlrRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .expect(200);

    expect(
      (afterIlrRes.body as { data: { pipelineState: string } }).data
        .pipelineState,
    ).toBe(EnrolmentPipelineState.ILR_CREATED);

    const pg2 = createE2ePgClient();
    await pg2.connect();
    let pushId = '';
    try {
      await pg2.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const row = await pg2.query<{ id: string }>(
        `SELECT id FROM enrolment_submission_pushes
         WHERE "enrolmentId" = $1 AND trigger = 'ilr_created'
         LIMIT 1`,
        [enrolmentId],
      );
      pushId = row.rows[0]?.id ?? '';
    } finally {
      await pg2.end();
    }
    expect(pushId).toBeTruthy();

    jest.spyOn(dasClient, 'submitEnrolment').mockResolvedValueOnce({
      reference: 'DAS-PIPELINE-E2E',
      status: 'accepted',
      raw: {},
    });

    await processEnrolmentPushJobInApp(app, {
      pushId,
      organisationId: employerOrgId,
      requestedByUserId: employer.userId,
    });

    const finalRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set('Authorization', `Bearer ${employer.accessToken}`)
      .set(ORGANISATION_ID_HEADER, employerOrgId)
      .expect(200);

    expect(
      (finalRes.body as { data: { pipelineState: string } }).data.pipelineState,
    ).toBe(EnrolmentPipelineState.DAS_CONFIRMED);
  });
});
