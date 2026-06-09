import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { PdfJobTemplate } from '../src/pdf/enums/pdf-job-template.enum.js';
import { ReviewSignerParty } from '../src/reviews/enums/review-signer-party.enum.js';
import { ReviewStatus } from '../src/reviews/enums/review-status.enum.js';
import { REVIEW_BULK_SCHEDULE_MAX } from '../src/reviews/reviews.constants.js';
import { StorageObjectCategory } from '../src/storage/enums/storage-object-category.enum.js';
import { noopStorageObjects } from '../src/storage/providers/noop-storage.store.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';

import type { App } from 'supertest/types';

describe('Reviews (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    noopStorageObjects.clear();
  });

  async function seedOrgContext(suffix: number) {
    const owner = await createVerifiedUser(app, {
      email: `reviews-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Reviews Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `REV-PROG-${suffix}`,
        title: 'Reviews Programme',
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
        code: `REV-STD-${suffix}`,
        title: 'Reviews Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Review',
        lastName: 'Apprentice',
        email: `reviews-apprentice-${suffix}@example.com`,
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

    return {
      owner,
      orgId,
      enrolmentId,
      apprenticeId,
    };
  }

  it('records audit logs for schedule, update, and review record', async () => {
    const suffix = Date.now();
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const scheduledAt = '2026-09-15T10:00:00.000Z';

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        scheduledAt,
        title: 'Progress review',
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const reviewId = (createRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ title: 'Updated progress review' })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/reviews/${reviewId}/record`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        payload: {
          smartGoals: [
            {
              objective: 'Complete module',
              measurable: '100%',
              achievable: 'Yes',
              relevant: 'Standard',
              timeBound: 'Sep 2026',
            },
          ],
          wellbeing: { score: 8, notes: 'Good' },
          progressSummary: 'On track',
        },
      })
      .expect(200);

    const auditReviews = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'reviews' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditReviews.body);
    const reviewRows = (
      auditReviews.body as {
        data: Array<{ action: AuditAction; entityId: string }>;
      }
    ).data;
    expect(reviewRows.some((r) => r.entityId === reviewId)).toBe(true);
    expect(reviewRows.some((r) => r.action === AuditAction.INSERT)).toBe(true);
    expect(reviewRows.some((r) => r.action === AuditAction.UPDATE)).toBe(true);

    const auditRecords = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'review_records' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditRecords.body);
    const recordRows = (
      auditRecords.body as {
        data: Array<{ action: AuditAction; entityType: string }>;
      }
    ).data;
    expect(recordRows.length).toBeGreaterThan(0);
    expect(recordRows.some((r) => r.action === AuditAction.INSERT)).toBe(true);
    expect(recordRows.every((r) => r.entityType === 'review_records')).toBe(
      true,
    );
  });

  it('lists reviews and retrieves review record', async () => {
    const suffix = Date.now() + 10;
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        scheduledAt: '2026-08-01T10:00:00.000Z',
        title: 'Mid-programme review',
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);
    expectSuccessEnvelope(createRes.body);
    const reviewId = (createRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .put(`/api/v1/reviews/${reviewId}/record`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        payload: {
          smartGoals: [
            {
              objective: 'Improve delivery',
              measurable: 'Two demos',
              achievable: 'Yes',
              relevant: 'Role',
              timeBound: 'Aug 2026',
            },
          ],
          wellbeing: { score: 7, notes: 'Stable' },
          progressSummary: 'Good progress',
        },
      })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/reviews')
      .query({ page: 1, perPage: 10, enrolmentId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);
    expectPaginatedListEnvelope(listRes.body);
    expect(
      (listRes.body as { data: Array<{ id: string }> }).data.some(
        (row) => row.id === reviewId,
      ),
    ).toBe(true);

    const recordRes = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}/record`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);
    expectSuccessEnvelope(recordRes.body);
    expect(
      (recordRes.body as { data: { payload: { progressSummary: string } } })
        .data.payload.progressSummary,
    ).toBe('Good progress');
  });

  it('lists reviews in calendar date range', async () => {
    const suffix = Date.now() + 1;
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const scheduledAt = '2026-10-01T09:00:00.000Z';

    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        scheduledAt,
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/reviews/calendar')
      .query({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.999Z',
      })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(listRes.body);
    const items = (listRes.body as { data: unknown[] }).data;
    expect(items.length).toBeGreaterThan(0);
  });

  it('rejects bulk schedule above cap', async () => {
    const suffix = Date.now() + 2;
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const items = Array.from({ length: REVIEW_BULK_SCHEDULE_MAX + 1 }, () => ({
      enrolmentId,
      apprenticeId,
      scheduledAt: '2026-11-01T10:00:00.000Z',
      apprenticeUserId: owner.userId,
      tutorUserId: owner.userId,
      employerManagerUserId: owner.userId,
    }));

    await request(app.getHttpServer())
      .post('/api/v1/reviews/bulk-schedule')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ items })
      .expect(400);
  });

  it('enforces co-sign party order after snapshot', async () => {
    const suffix = Date.now() + 3;
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        scheduledAt: '2026-12-01T10:00:00.000Z',
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);

    const reviewId = (createRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .put(`/api/v1/reviews/${reviewId}/record`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        payload: {
          smartGoals: [
            {
              objective: 'A',
              measurable: 'B',
              achievable: 'C',
              relevant: 'D',
              timeBound: 'E',
            },
          ],
          wellbeing: { score: 5 },
        },
      })
      .expect(200);

    const snapshotRes = await request(app.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/snapshot-pdf`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    const jobId = (snapshotRes.body as { data: { jobId: string } }).data.jobId;
    await processPdfJobInApp(app, {
      jobId,
      organisationId: orgId,
      userId: owner.userId,
      template: PdfJobTemplate.REVIEW_SNAPSHOT,
      reviewId,
    });

    const signatureKey = `orgs/${orgId}/${StorageObjectCategory.SIGNATURE}/sig-obj/signature.png`;
    noopStorageObjects.set(signatureKey, Buffer.from('fake-signature'));

    await request(app.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/sign`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        party: ReviewSignerParty.EMPLOYER_MANAGER,
        signatureImageKey: signatureKey,
      })
      .expect(409);

    const signRes = await request(app.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/sign`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        party: ReviewSignerParty.APPRENTICE,
        signatureImageKey: signatureKey,
      })
      .expect(201);

    expectSuccessEnvelope(signRes.body);
    expect(
      (signRes.body as { data: { nextParty: string } }).data.nextParty,
    ).toBe(ReviewSignerParty.TUTOR);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { status: string } }).data.status).toBe(
      ReviewStatus.AWAITING_SIGNATURES,
    );

    const auditSignatures = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'review_signatures' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditSignatures.body);
    const signatureRows = (
      auditSignatures.body as {
        data: Array<{ action: AuditAction; entityType: string }>;
      }
    ).data;
    expect(signatureRows.length).toBeGreaterThan(0);
    expect(
      signatureRows.every((r) => r.entityType === 'review_signatures'),
    ).toBe(true);
    expect(signatureRows.some((r) => r.action === AuditAction.UPDATE)).toBe(
      true,
    );
  });
});
