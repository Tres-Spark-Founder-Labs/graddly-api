import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  createLearnerScopeContext,
  type ILearnerScopeContext,
} from './helpers/learner-scope-e2e.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/** Computed key: a literal `Authorization:` trips the naming-convention rule. */
const AUTH_HEADER = 'Authorization';

/**
 * Portal 3, survey finding 4 — the suspected cross-learner OTJ exposure,
 * settled.
 *
 * WHAT THE FIRST RUN OF THIS FILE FOUND. Against the code as inherited, three
 * of these five failed. `GET /otj-log-entries` returned another learner's
 * session (category (d), unscoped); `GET /otj-log-entries/:id` returned it by
 * id (category (c)); and `PATCH /otj-log-entries/:id` returned **200** — one
 * learner could edit another's funding-relevant record, which is materially
 * worse than the read-only exposure the survey suspected. The two cross-tenant
 * cases passed, so organisation isolation held; the breach was strictly inside
 * a tenant.
 *
 * WHY NO EXISTING FIXTURE EVER CAUGHT IT. Every other fixture in this suite
 * creates exactly one apprentice per organisation, so the suite was
 * structurally incapable of expressing "two learners at one provider". A suite
 * that cannot express the scenario will never fail on it — see
 * `helpers/learner-scope-e2e.ts`, which exists to make it expressible.
 *
 * These assertions are written as the behaviour client decision D3 requires,
 * so they failed before the fix and are permanent regression cover after it.
 */
describe('OTJ learner scope (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: ILearnerScopeContext;
  let strangerHeaders: Record<string, string>;

  beforeAll(async () => {
    app = await createE2eApp();
    ctx = await createLearnerScopeContext(app, 'otj');

    const stranger = await createProviderDirectoryContext(app, 'otjscope-x');
    strangerHeaders = {
      [AUTH_HEADER]: `Bearer ${stranger.owner.accessToken}`,
      [ORGANISATION_ID_HEADER]: stranger.providerOrgId,
    };
  }, 180_000);

  afterAll(async () => {
    await ctx?.sudo?.end();
    await app?.close();
  });

  const asLearnerA = () => ctx.learnerA.headers;

  describe('cross-learner, same tenant', () => {
    /**
     * `findAll` scoped by `otj.organisationId` and applied `otj.apprenticeId`
     * only when the caller supplied it — so an unfiltered request from an
     * apprentice returned whatever the organisation held.
     */
    it('does not return another learner in an unfiltered list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .set(asLearnerA())
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain(ctx.learnerB.marker);
    });

    /**
     * `findAccessibleEntry` resolved by id against the organisation with no
     * principal check, so a guessed or leaked id was enough.
     */
    it('does not return another learner entry by direct id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/otj-log-entries/${ctx.learnerB.submittedOtjEntryId}`)
        .set(asLearnerA())
        .expect(404);
    });

    /** Reads were the suspicion; a write on another learner's row is worse. */
    it('cannot modify another learner entry', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/otj-log-entries/${ctx.learnerB.submittedOtjEntryId}`)
        .set(asLearnerA())
        .send({ activityName: 'tampered' });

      expect([403, 404]).toContain(res.status);
    });

    it('cannot delete another learner entry', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/otj-log-entries/${ctx.learnerB.submittedOtjEntryId}`)
        .set(asLearnerA());

      expect([403, 404]).toContain(res.status);
    });

    /**
     * The filter is a client-supplied parameter, so asking for another
     * learner's id explicitly must not be a way around the principal scope.
     */
    it('cannot select another learner by passing their apprenticeId', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .query({ apprenticeId: ctx.learnerB.apprenticeId })
        .set(asLearnerA())
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain(ctx.learnerB.marker);
    });
  });

  /**
   * The write side, which the read-side narrowing does not cover and which the
   * original survey did not consider.
   *
   * `assertEnrolmentMatch` proved only that the enrolment was in the
   * organisation and that the apprentice matched it — both true of every other
   * learner's enrolment. So a learner could post hours onto a peer's
   * programme, or move one of their own entries onto it. Hours on the wrong
   * enrolment are a funding-claim defect, not only a privacy one.
   */
  describe('cross-learner writes', () => {
    it("cannot log a session against another learner's enrolment", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/otj-log-entries')
        .set(asLearnerA())
        .send({
          enrolmentId: ctx.learnerB.enrolmentId,
          apprenticeId: ctx.learnerB.apprenticeId,
          activityName: 'INJECTED-ONTO-PEER',
          category: 'other',
          loggedDate: new Date().toISOString().slice(0, 10),
          minutes: 60,
        });

      expect([400, 403, 404]).toContain(res.status);
    });

    it("cannot move an own entry onto another learner's enrolment", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/otj-log-entries/${ctx.learnerA.submittedOtjEntryId}`)
        .set(asLearnerA())
        .send({
          enrolmentId: ctx.learnerB.enrolmentId,
          apprenticeId: ctx.learnerB.apprenticeId,
        });

      expect([400, 403, 404]).toContain(res.status);
    });

    it("the injected session never reaches the other learner's record", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .set(ctx.staffHeaders)
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain('INJECTED-ONTO-PEER');
    });
  });

  describe('the learner keeps their own access', () => {
    it('lists their own sessions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .set(asLearnerA())
        .expect(200);

      expect(JSON.stringify(res.body)).toContain(ctx.learnerA.marker);
    });

    it('reads their own session by id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/otj-log-entries/${ctx.learnerA.submittedOtjEntryId}`)
        .set(asLearnerA())
        .expect(200);
    });

    it('can still log a new session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/otj-log-entries')
        .set(asLearnerA())
        .send({
          enrolmentId: ctx.learnerA.enrolmentId,
          apprenticeId: ctx.learnerA.apprenticeId,
          activityName: 'Own new session',
          category: 'other',
          loggedDate: new Date().toISOString().slice(0, 10),
          minutes: 60,
        })
        .expect(201);
    });
  });

  describe('cross-tenant', () => {
    it('does not return an entry from another organisation', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/otj-log-entries/${ctx.learnerA.submittedOtjEntryId}`)
        .set(strangerHeaders)
        .expect(404);
    });

    it('does not leak entries into another organisation list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .set(strangerHeaders)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(ctx.learnerA.marker);
      expect(body).not.toContain(ctx.learnerB.marker);
    });
  });

  /**
   * D3 constrains the learner role only. The provider must keep the view that
   * is the platform's whole purpose.
   */
  describe('provider staff visibility is unbroken', () => {
    it('staff still list every entry in the organisation', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/otj-log-entries')
        .set(ctx.staffHeaders)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).toContain(ctx.learnerA.marker);
      expect(body).toContain(ctx.learnerB.marker);
    });

    it('staff still read any entry by id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/otj-log-entries/${ctx.learnerB.submittedOtjEntryId}`)
        .set(ctx.staffHeaders)
        .expect(200);
    });
  });
});
