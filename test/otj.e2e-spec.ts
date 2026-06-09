import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { OtjActivityCategory } from '../src/otj/enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../src/otj/enums/otj-log-status.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import {
  createEnrolment,
  createOrgOwnerContext,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('OTJ log entries (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('records audit logs for create, update, approve, and delete actions', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `otj-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`OTJ Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `OTJ-PROG-${suffix}`,
        title: 'OTJ Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        programmeId,
        code: `OTJ-STD-${suffix}`,
        title: 'OTJ Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Otj',
        lastName: 'Apprentice',
        email: `otj-apprentice-${suffix}@example.com`,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    const categoriesRes = await request(app.getHttpServer())
      .get('/api/v1/otj-log-entries/categories')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);
    expectSuccessEnvelope(categoriesRes.body);
    const categories = (
      categoriesRes.body as {
        data: Array<{ slug: string; label: string }>;
      }
    ).data;
    expect(categories.length).toBe(6);
    expect(categories.some((c) => c.slug === 'taught_learning')).toBe(true);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/otj-log-entries')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        activityName: 'Workshop day',
        category: OtjActivityCategory.TAUGHT_LEARNING,
        loggedDate: '2026-01-15',
        minutes: 120,
        note: 'Optional extra detail',
      })
      .expect(201);
    expectSuccessEnvelope(createRes.body);
    const otjId = (createRes.body as { data: { id: string } }).data.id;
    expect((createRes.body as { data: { status: string } }).data.status).toBe(
      OtjLogStatus.DRAFT,
    );
    expect(
      (createRes.body as { data: { activityName: string } }).data.activityName,
    ).toBe('Workshop day');
    expect(
      (createRes.body as { data: { category: string } }).data.category,
    ).toBe(OtjActivityCategory.TAUGHT_LEARNING);

    const submitRes = await request(app.getHttpServer())
      .patch(`/api/v1/otj-log-entries/${otjId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ status: OtjLogStatus.SUBMITTED, minutes: 150 })
      .expect(200);
    expectSuccessEnvelope(submitRes.body);
    expect((submitRes.body as { data: { status: string } }).data.status).toBe(
      OtjLogStatus.SUBMITTED,
    );

    const approveRes = await request(app.getHttpServer())
      .post('/api/v1/otj-log-entries/bulk-approve')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ ids: [otjId] })
      .expect(201);
    expectSuccessEnvelope(approveRes.body);
    expect(
      (approveRes.body as { data: { succeeded: number } }).data.succeeded,
    ).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/otj-log-entries/${otjId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(204);

    const auditRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'otj_log_entries' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditRes.body);
    const rows = (
      auditRes.body as {
        data: Array<{
          action: AuditAction;
          entityType: string;
          entityId: string;
        }>;
      }
    ).data;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.entityType === 'otj_log_entries')).toBe(
      true,
    );
    expect(rows.some((row) => row.entityId === otjId)).toBe(true);
    expect(rows.some((row) => row.action === AuditAction.INSERT)).toBe(true);
    expect(rows.some((row) => row.action === AuditAction.UPDATE)).toBe(true);
    expect(rows.some((row) => row.action === AuditAction.DELETE)).toBe(true);
  });

  it('lists, retrieves, and bulk-rejects submitted OTJ entries', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(app, 'OTJ List Org');
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

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(authHeaders)
      .expect(201);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/otj-log-entries')
      .set(authHeaders)
      .send({
        enrolmentId,
        apprenticeId,
        activityName: 'Shadowing session',
        category: OtjActivityCategory.JOB_SHADOWING,
        loggedDate: '2026-02-10',
        minutes: 90,
      })
      .expect(201);
    expectSuccessEnvelope(createRes.body);
    const otjId = (createRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/otj-log-entries/${otjId}`)
      .set(authHeaders)
      .send({ status: OtjLogStatus.SUBMITTED })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/otj-log-entries')
      .query({ page: 1, perPage: 10, enrolmentId })
      .set(authHeaders)
      .expect(200);
    expectPaginatedListEnvelope(listRes.body);
    expect(
      (listRes.body as { data: Array<{ id: string }> }).data.some(
        (row) => row.id === otjId,
      ),
    ).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/otj-log-entries/${otjId}`)
      .set(authHeaders)
      .expect(200);
    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { id: string } }).data.id).toBe(otjId);

    const rejectRes = await request(app.getHttpServer())
      .post('/api/v1/otj-log-entries/bulk-reject')
      .set(authHeaders)
      .send({ ids: [otjId], reason: 'Insufficient detail' })
      .expect(201);
    expectSuccessEnvelope(rejectRes.body);
    expect(
      (rejectRes.body as { data: { succeeded: number } }).data.succeeded,
    ).toBe(1);

    const rejectedRes = await request(app.getHttpServer())
      .get(`/api/v1/otj-log-entries/${otjId}`)
      .set(authHeaders)
      .expect(200);
    expect((rejectedRes.body as { data: { status: string } }).data.status).toBe(
      OtjLogStatus.REJECTED,
    );
  });
});
