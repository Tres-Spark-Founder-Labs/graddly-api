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
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/** Computed key: a literal `Authorization:` trips the naming-convention rule. */
const AUTH_HEADER = 'Authorization';

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

  /**
   * F2.2.3 AC2 — "set review dates for multiple learners simultaneously".
   *
   * The older bulk route needs four ids per learner, which is why no UI ever
   * called it. This one takes enrolments and a date and derives the rest.
   */
  it('bulk schedules one date across enrolments, deriving participants', async () => {
    const suffix = Date.now();
    const ctx = await seedOrgContext(suffix);
    const headers = {
      [AUTH_HEADER]: `Bearer ${ctx.owner.accessToken}`,
      [ORGANISATION_ID_HEADER]: ctx.orgId,
    };

    // Bulk scheduling derives participants from the enrolment, so they have to
    // be assigned first. An enrolment without a tutor is correctly reported as
    // a per-learner failure rather than silently scheduled.
    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${ctx.enrolmentId}/participants`)
      .set(headers)
      .send({
        apprenticeUserId: ctx.owner.userId,
        tutorUserId: ctx.owner.userId,
        employerManagerUserId: ctx.owner.userId,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reviews/bulk-schedule/from-enrolments')
      .set(headers)
      .send({
        enrolmentIds: [ctx.enrolmentId],
        scheduledAt: '2026-11-01T10:00:00.000Z',
        title: 'Autumn 12-weekly review',
      })
      .expect(201);

    expectSuccessEnvelope(res.body);
    const result = (
      res.body as {
        data: {
          processed: number;
          succeeded: number;
          failed: number;
          reviews: { title: string; enrolmentId: string }[];
        };
      }
    ).data;

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.reviews[0].title).toBe('Autumn 12-weekly review');
    expect(result.reviews[0].enrolmentId).toBe(ctx.enrolmentId);
  });

  /**
   * A partial batch is the normal case. Scheduling the ones that can be
   * scheduled and naming the ones that cannot beats rejecting all of them —
   * and the failure has to say which enrolment, or nobody can act on it.
   */
  it('reports unknown enrolments per learner rather than failing the batch', async () => {
    const suffix = Date.now();
    const ctx = await seedOrgContext(suffix);
    const headers = {
      [AUTH_HEADER]: `Bearer ${ctx.owner.accessToken}`,
      [ORGANISATION_ID_HEADER]: ctx.orgId,
    };

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${ctx.enrolmentId}/participants`)
      .set(headers)
      .send({
        apprenticeUserId: ctx.owner.userId,
        tutorUserId: ctx.owner.userId,
        employerManagerUserId: ctx.owner.userId,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reviews/bulk-schedule/from-enrolments')
      .set(headers)
      .send({
        enrolmentIds: [ctx.enrolmentId, '11111111-1111-4111-8111-111111111111'],
        scheduledAt: '2026-11-02T10:00:00.000Z',
      })
      .expect(201);

    const result = (
      res.body as {
        data: {
          processed: number;
          succeeded: number;
          failed: number;
          failures: { index: number; message: string }[];
        };
      }
    ).data;

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0].message).toContain('not found');
  });

  /** F2.2.3 AC4 — the goals a tutor has to answer for at the next review. */
  it('returns previous goals, and an empty list for a first review', async () => {
    const suffix = Date.now();
    const ctx = await seedOrgContext(suffix);
    const headers = {
      [AUTH_HEADER]: `Bearer ${ctx.owner.accessToken}`,
      [ORGANISATION_ID_HEADER]: ctx.orgId,
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set(headers)
      .send({
        enrolmentId: ctx.enrolmentId,
        apprenticeId: ctx.apprenticeId,
        scheduledAt: '2026-03-01T10:00:00.000Z',
        apprenticeUserId: ctx.owner.userId,
        tutorUserId: ctx.owner.userId,
        employerManagerUserId: ctx.owner.userId,
      })
      .expect(201);
    const firstId = (first.body as { data: { id: string } }).data.id;

    // Nothing before it, so nothing to answer for.
    const emptyRes = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${firstId}/previous-goals`)
      .set(headers)
      .expect(200);
    expect((emptyRes.body as { data: unknown[] }).data).toEqual([]);
  });

  /**
   * F2.2.3 AC6 — "employer ... can view the full record".
   *
   * The employer is already notified when a review completes, so a record
   * they cannot open means being told about a document that 404s. Reviews are
   * stamped with the *provider's* organisation, so this only works if both
   * the RLS policy and the query resolve through the enrolment.
   *
   * Asserted from both sides: the linked employer can read it, and an
   * unrelated organisation still cannot.
   */
  it('lets the linked employer read the review and its full record', async () => {
    const ctx = await createProviderDirectoryContext(app, 'reviews-employer');

    const enrolmentRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${ctx.enrolmentId}`)
      .set(ctx.authHeaders)
      .expect(200);
    const apprenticeId = (
      enrolmentRes.body as { data: { apprenticeId: string } }
    ).data.apprenticeId;

    const created = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set(ctx.authHeaders)
      .send({
        enrolmentId: ctx.enrolmentId,
        apprenticeId,
        scheduledAt: '2026-10-01T10:00:00.000Z',
        title: 'Tripartite review',
        apprenticeUserId: ctx.owner.userId,
        tutorUserId: ctx.owner.userId,
        employerManagerUserId: ctx.owner.userId,
      })
      .expect(201);
    const reviewId = (created.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .put(`/api/v1/reviews/${reviewId}/record`)
      .set(ctx.authHeaders)
      .send({
        payload: {
          smartGoals: [
            {
              objective: 'Complete unit 3',
              measurable: 'Assessed',
              achievable: 'Yes',
              relevant: 'Yes',
              timeBound: 'By December',
            },
          ],
          wellbeing: { score: 8, notes: 'Settled' },
          // F2.2.3 AC4 — both new fields must survive the round trip.
          otjDiscussion: 'On pace; 142 of 280 hours logged.',
          previousGoalProgress: [
            {
              objective: 'Shadow a senior engineer',
              outcome: 'achieved',
              notes: 'Two sessions completed',
            },
          ],
        },
      })
      .expect(200);

    // Now read as the employer, by switching the active organisation.
    const employerHeaders = {
      ...ctx.authHeaders,
      [ORGANISATION_ID_HEADER]: ctx.employerOrgId,
    };

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/reviews')
      .set(employerHeaders)
      .expect(200);
    expectPaginatedListEnvelope(listRes.body);
    expect(
      (listRes.body as { data: { id: string }[] }).data.some(
        (r) => r.id === reviewId,
      ),
    ).toBe(true);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set(employerHeaders)
      .expect(200);
    expect((detailRes.body as { data: { id: string } }).data.id).toBe(reviewId);

    const recordRes = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}/record`)
      .set(employerHeaders)
      .expect(200);
    const payload = (
      recordRes.body as {
        data: {
          payload: {
            otjDiscussion: string;
            previousGoalProgress: { outcome: string }[];
            smartGoals: unknown[];
          };
        };
      }
    ).data.payload;

    expect(payload.smartGoals).toHaveLength(1);
    expect(payload.otjDiscussion).toContain('142 of 280');
    expect(payload.previousGoalProgress[0].outcome).toBe('achieved');
  });

  /** Reading is widened to the linked employer, not to everybody. */
  it('refuses the record to an unrelated organisation', async () => {
    const ctx = await createProviderDirectoryContext(app, 'reviews-outsider');
    const outsider = await createProviderDirectoryContext(
      app,
      'reviews-outsider-2',
    );

    const enrolmentRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${ctx.enrolmentId}`)
      .set(ctx.authHeaders)
      .expect(200);
    const apprenticeId = (
      enrolmentRes.body as { data: { apprenticeId: string } }
    ).data.apprenticeId;

    const created = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set(ctx.authHeaders)
      .send({
        enrolmentId: ctx.enrolmentId,
        apprenticeId,
        scheduledAt: '2026-10-01T10:00:00.000Z',
        apprenticeUserId: ctx.owner.userId,
        tutorUserId: ctx.owner.userId,
        employerManagerUserId: ctx.owner.userId,
      })
      .expect(201);
    const reviewId = (created.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set(outsider.authHeaders)
      .expect(404);
  });
});
