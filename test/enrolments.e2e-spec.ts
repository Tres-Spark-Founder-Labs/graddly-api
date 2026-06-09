import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { loginVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectFilteredHttpExceptionBody,
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import {
  createEnrolment,
  createOrgOwnerContext,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('Enrolments + domain APIs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an enrolment via POST /enrolments', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(
      app,
      'Enrol Create Org',
    );
    const { apprenticeId, standardId } = await seedProgrammeGraph(
      app,
      authHeaders,
      { suffix },
    );

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set(authHeaders)
      .send({ apprenticeId, standardId })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    expect(
      (createRes.body as { data: { apprenticeId: string } }).data.apprenticeId,
    ).toBe(apprenticeId);
    expect(
      (createRes.body as { data: { standardId: string } }).data.standardId,
    ).toBe(standardId);
  });

  it('updates enrolment participants and organisation links', async () => {
    const suffix = Date.now();
    const { owner, authHeaders, orgId } = await createOrgOwnerContext(
      app,
      'Enrol Links Org',
    );
    const { apprenticeId, standardId } = await seedProgrammeGraph(
      app,
      authHeaders,
      { suffix },
    );
    const enrolmentId = await createEnrolment(
      app,
      authHeaders,
      apprenticeId,
      standardId,
    );

    const employerOrgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Employer Link Org ${suffix}`))
      .expect(201);
    const employerOrganisationId = (
      employerOrgRes.body as { data: { id: string } }
    ).data.id;

    const participantsRes = await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set(authHeaders)
      .send({
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(200);
    expectSuccessEnvelope(participantsRes.body);
    expect(
      (participantsRes.body as { data: { apprenticeUserId: string } }).data
        .apprenticeUserId,
    ).toBe(owner.userId);

    const linksRes = await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/organisation-links`)
      .set(authHeaders)
      .send({ employerOrganisationId })
      .expect(200);
    expectSuccessEnvelope(linksRes.body);
    expect(
      (linksRes.body as { data: { employerOrganisationId: string } }).data
        .employerOrganisationId,
    ).toBe(employerOrganisationId);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set(authHeaders)
      .expect(200);
    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { id: string } }).data.id).toBe(enrolmentId);
    expect(
      (getRes.body as { data: { organisationId: string } }).data.organisationId,
    ).toBe(orgId);
  });

  it('supports scoped lifecycle and emits audit logs', async () => {
    const suffix = Date.now();
    const { owner, authHeaders: orgOneHeaders } = await createOrgOwnerContext(
      app,
      'Enrol Org One',
    );

    const orgTwoRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Enrol Org Two ${suffix}`))
      .expect(201);
    const orgTwoId = (orgTwoRes.body as { data: { id: string } }).data.id;

    const { programmeId, standardId, apprenticeId } = await seedProgrammeGraph(
      app,
      orgOneHeaders,
      {
        suffix,
        programmeCode: `PROG-${suffix}`,
        standardCode: `STD-${suffix}`,
        apprenticeEmail: `apprentice-${suffix}@example.com`,
      },
    );

    const getProgrammeRes = await request(app.getHttpServer())
      .get(`/api/v1/programmes/${programmeId}`)
      .set(orgOneHeaders)
      .expect(200);
    expectSuccessEnvelope(getProgrammeRes.body);
    expect((getProgrammeRes.body as { data: { id: string } }).data.id).toBe(
      programmeId,
    );

    const getStandardRes = await request(app.getHttpServer())
      .get(`/api/v1/standards/${standardId}`)
      .set(orgOneHeaders)
      .expect(200);
    expectSuccessEnvelope(getStandardRes.body);

    const getApprenticeRes = await request(app.getHttpServer())
      .get(`/api/v1/apprentices/${apprenticeId}`)
      .set(orgOneHeaders)
      .expect(200);
    expectSuccessEnvelope(getApprenticeRes.body);

    const enrolmentId = await createEnrolment(
      app,
      orgOneHeaders,
      apprenticeId,
      standardId,
    );
    const getEnrolmentRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set(orgOneHeaders)
      .expect(200);
    expectSuccessEnvelope(getEnrolmentRes.body);

    const programmesListRes = await request(app.getHttpServer())
      .get('/api/v1/programmes')
      .query({ page: 1, perPage: 10 })
      .set(orgOneHeaders)
      .expect(200);
    expectPaginatedListEnvelope(programmesListRes.body);
    expect(
      (
        programmesListRes.body as {
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

    const standardsListRes = await request(app.getHttpServer())
      .get('/api/v1/standards')
      .query({ page: 1, perPage: 10 })
      .set(orgOneHeaders)
      .expect(200);
    expectPaginatedListEnvelope(standardsListRes.body);

    const apprenticesListRes = await request(app.getHttpServer())
      .get('/api/v1/apprentices')
      .query({ page: 1, perPage: 10 })
      .set(orgOneHeaders)
      .expect(200);
    expectPaginatedListEnvelope(apprenticesListRes.body);

    const refreshed = await loginVerifiedUser(app, owner.email, owner.password);
    owner.accessToken = refreshed.accessToken;
    orgOneHeaders['Authorization'] = `Bearer ${refreshed.accessToken}`;

    const enrolmentsListRes = await request(app.getHttpServer())
      .get('/api/v1/enrolments')
      .query({ page: 1, perPage: 10 })
      .set(orgOneHeaders)
      .expect(200);
    expectPaginatedListEnvelope(enrolmentsListRes.body);

    const updatedProgrammeRes = await request(app.getHttpServer())
      .patch(`/api/v1/programmes/${programmeId}`)
      .set(orgOneHeaders)
      .send({ title: 'Programme One Updated' })
      .expect(200);
    expectSuccessEnvelope(updatedProgrammeRes.body);
    expect(
      (updatedProgrammeRes.body as { data: { title: string } }).data.title,
    ).toBe('Programme One Updated');

    const updatedStandardRes = await request(app.getHttpServer())
      .patch(`/api/v1/standards/${standardId}`)
      .set(orgOneHeaders)
      .send({ title: 'Standard One Updated' })
      .expect(200);
    expectSuccessEnvelope(updatedStandardRes.body);

    const updatedApprenticeRes = await request(app.getHttpServer())
      .patch(`/api/v1/apprentices/${apprenticeId}`)
      .set(orgOneHeaders)
      .send({ firstName: 'Ap Updated' })
      .expect(200);
    expectSuccessEnvelope(updatedApprenticeRes.body);

    const activeRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(orgOneHeaders)
      .expect(201);
    expectSuccessEnvelope(activeRes.body);
    expect((activeRes.body as { data: { status: string } }).data.status).toBe(
      EnrolmentStatus.ACTIVE,
    );

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/complete`)
      .set(orgOneHeaders)
      .expect(201);
    expectSuccessEnvelope(completeRes.body);
    expect((completeRes.body as { data: { status: string } }).data.status).toBe(
      EnrolmentStatus.COMPLETED,
    );

    const crossOrgRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set({
        ...orgOneHeaders,
        [ORGANISATION_ID_HEADER]: orgTwoId,
      })
      .expect(404);
    expectFilteredHttpExceptionBody(
      crossOrgRes.body as Record<string, unknown>,
      {
        statusCode: 404,
        message: 'Enrolment not found',
        path: `/api/v1/enrolments/${enrolmentId}`,
        error: 'Not Found',
      },
    );

    const apprenticeTwoRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set(orgOneHeaders)
      .send({
        firstName: 'Cancel',
        lastName: 'Flow',
        email: `apprentice-cancel-${suffix}@example.com`,
      })
      .expect(201);
    expectSuccessEnvelope(apprenticeTwoRes.body);
    const apprenticeTwoId = (apprenticeTwoRes.body as { data: { id: string } })
      .data.id;

    const enrolmentToCancelId = await createEnrolment(
      app,
      orgOneHeaders,
      apprenticeTwoId,
      standardId,
    );

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentToCancelId}/cancel`)
      .set(orgOneHeaders)
      .expect(201);
    expectSuccessEnvelope(cancelRes.body);
    expect((cancelRes.body as { data: { status: string } }).data.status).toBe(
      EnrolmentStatus.CANCELLED,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/apprentices/${apprenticeTwoId}`)
      .set(orgOneHeaders)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/v1/standards/${standardId}`)
      .set(orgOneHeaders)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/v1/programmes/${programmeId}`)
      .set(orgOneHeaders)
      .expect(204);

    const auditRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'enrolments' })
      .set(orgOneHeaders)
      .expect(200);

    expectSuccessEnvelope(auditRes.body);
    const rows = (auditRes.body as { data: Array<{ action: AuditAction }> })
      .data;
    expect(rows.some((row) => row.action === AuditAction.INSERT)).toBe(true);
    expect(rows.some((row) => row.action === AuditAction.UPDATE)).toBe(true);
  });
});
