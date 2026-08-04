import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/**
 * F2.2.5 — tutor caseload management.
 */
describe('Tutor caseload (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface ICaseload {
    tutors: {
      tutorUserId: string | null;
      tutorName: string;
      learnerCount: number;
      atRiskCount: number;
      reviewComplianceRate: number | null;
      exceedsAtRiskThreshold: boolean;
    }[];
    atRiskThreshold: number;
    totalLearners: number;
    totalAtRisk: number;
  }

  const getCaseload = async (
    ctx: Awaited<ReturnType<typeof createProviderDirectoryContext>>,
  ): Promise<ICaseload> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/caseload')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    return (res.body as { data: ICaseload }).data;
  };

  /**
   * AC2. A learner with no tutor is the most urgent caseload problem a manager
   * has, so the dashboard reports them rather than filtering them out.
   */
  it('reports unassigned learners and the configured threshold', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cl-unassigned');

    const caseload = await getCaseload(ctx);

    expect(caseload.atRiskThreshold).toBe(5);
    expect(caseload.totalLearners).toBeGreaterThan(0);
    const unassigned = caseload.tutors.find((t) => t.tutorUserId === null);
    expect(unassigned?.tutorName).toBe('Unassigned');
  });

  /**
   * AC1 — the bulk half. Per-learner assignment already existed on the
   * enrolment participants route.
   */
  it('assigns a tutor across many enrolments', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cl-assign');

    const res = await request(app.getHttpServer())
      .post('/api/v1/learners/caseload/assign-tutor')
      .set(ctx.authHeaders)
      .send({
        enrolmentIds: [ctx.enrolmentId],
        tutorUserId: ctx.owner.userId,
      })
      .expect(201);

    expectSuccessEnvelope(res.body);
    expect((res.body as { data: { updated: number } }).data.updated).toBe(1);

    const caseload = await getCaseload(ctx);
    const assigned = caseload.tutors.find(
      (t) => t.tutorUserId === ctx.owner.userId,
    );
    expect(assigned?.learnerCount).toBe(1);
  });

  /**
   * AC4 — "tutor reassignment is tracked in the audit trail".
   *
   * This is the test that stops the bulk write being "optimised" into a
   * repo.update(), which would be faster and would silently write nothing to
   * the trail: TypeORM subscribers do not fire for QueryBuilder writes.
   */
  it('records the reassignment in the audit trail', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cl-audit');

    await request(app.getHttpServer())
      .post('/api/v1/learners/caseload/assign-tutor')
      .set(ctx.authHeaders)
      .send({
        enrolmentIds: [ctx.enrolmentId],
        tutorUserId: ctx.owner.userId,
      })
      .expect(201);

    // The trail is exposed at /audit/export, and entityType is the table
    // name the subscriber records, not the entity class name.
    const audit = await request(app.getHttpServer())
      .get('/api/v1/audit/export?entityType=enrolments&page=1&perPage=50')
      .set(ctx.authHeaders)
      .expect(200);

    const entries = (
      audit.body as {
        data: { entityType: string; entityId: string; action: string }[];
      }
    ).data;

    const entry = entries.find(
      (e) => e.entityId === ctx.enrolmentId && e.action === AuditAction.UPDATE,
    );
    expect(entry).toBeDefined();
    expect(entry!.entityType).toBe('enrolments');
  });

  it('un-assigns when given a null tutor', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cl-unassign');

    await request(app.getHttpServer())
      .post('/api/v1/learners/caseload/assign-tutor')
      .set(ctx.authHeaders)
      .send({
        enrolmentIds: [ctx.enrolmentId],
        tutorUserId: ctx.owner.userId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/learners/caseload/assign-tutor')
      .set(ctx.authHeaders)
      .send({ enrolmentIds: [ctx.enrolmentId], tutorUserId: null })
      .expect(201);

    const caseload = await getCaseload(ctx);
    expect(
      caseload.tutors.find((t) => t.tutorUserId === null)?.learnerCount,
    ).toBe(1);
  });

  it('does not reassign enrolments belonging to another provider', async () => {
    const mine = await createProviderDirectoryContext(app, 'cl-mine');
    const theirs = await createProviderDirectoryContext(app, 'cl-theirs');

    const res = await request(app.getHttpServer())
      .post('/api/v1/learners/caseload/assign-tutor')
      .set(mine.authHeaders)
      .send({
        enrolmentIds: [theirs.enrolmentId],
        tutorUserId: mine.owner.userId,
      })
      .expect(201);

    // Not found under this organisation, so nothing is written.
    expect((res.body as { data: { updated: number } }).data.updated).toBe(0);
  });
});
