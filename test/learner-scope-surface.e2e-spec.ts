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
 * P0-B step 4 — the wider learner-reachable surface.
 *
 * `otj-learner-scope.e2e-spec.ts` settles the OTJ endpoints survey finding 4
 * named. This file settles the rest, because the root cause was never specific
 * to OTJ: there is no learner role in this platform. An apprentice holds
 * `OrganisationRole.MEMBER` of the provider organisation — the same membership
 * a tutor holds — so every endpoint whose only gate was "authenticated member
 * of this org" was, from a learner's seat, unscoped by construction.
 *
 * ── HOW THESE ASSERTIONS ARE BUILT ───────────────────────────────────────────
 *
 * Every negative is paired with a positive that proves the marker is *visible
 * in that response shape at all*. The first draft of this file asserted that
 * `/learners/cohort` did not contain another learner's `apprenticeId` — and it
 * passed, because the cohort DTO carries `enrolmentId` and `learnerName` and
 * never carries `apprenticeId`. That assertion would have passed just as
 * happily with every guard deleted. Pairing it with a staff call that must
 * contain the same marker makes a wrong marker fail loudly instead of passing
 * quietly.
 *
 * For the same reason the fixture seeds a review and a portfolio item per
 * learner. A "cannot see B's review" test against an empty reviews table is
 * decoration, not cover.
 */
describe('Learner scope surface (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: ILearnerScopeContext;
  let strangerHeaders: Record<string, string>;

  const NON_EXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await createE2eApp();
    ctx = await createLearnerScopeContext(app, 'surface');

    const stranger = await createProviderDirectoryContext(app, 'scope-x');
    strangerHeaders = {
      [AUTH_HEADER]: `Bearer ${stranger.owner.accessToken}`,
      [ORGANISATION_ID_HEADER]: stranger.providerOrgId,
    };
  }, 180_000);

  afterAll(async () => {
    await ctx?.sudo?.end();
    await app?.close();
  });

  const asA = () => ctx.learnerA.headers;
  const bodyOf = (res: request.Response) => JSON.stringify(res.body ?? {});

  /**
   * Routes a learner has no business reaching at all. The fix denies these
   * wholesale rather than filtering them, because there is no subset of a
   * tutor caseload or an intervention queue that belongs to a learner.
   *
   * Asserted on status, not body: a status assertion is meaningful whether or
   * not the table happens to hold rows, which a body assertion is not.
   */
  const DENIED_TO_LEARNERS: ReadonlyArray<[string, string]> = [
    ['GET', '/api/v1/apprentices'],
    ['GET', '/api/v1/learners/cohort'],
    ['GET', '/api/v1/learners/cohort/filter-options'],
    ['GET', '/api/v1/learners/caseload'],
    ['GET', '/api/v1/learners/intervention-queue'],
    ['GET', '/api/v1/commitment-statements'],
    ['GET', '/api/v1/commitment-statements/board'],
    ['GET', '/api/v1/reviews/calendar'],
    ['GET', '/api/v1/ilr/learner-records'],
    ['GET', '/api/v1/ilr/funding-claims'],
    ['GET', '/api/v1/audit/export'],
    ['GET', '/api/v1/reporting/provider-dashboard'],
    ['GET', '/api/v1/enrolment-pushes/failed'],
    ['GET', '/api/v1/completion-pushes/failed'],
    ['GET', '/api/v1/withdrawal-pushes/failed'],
  ];

  describe('routes a learner must not reach at all', () => {
    /**
     * 404 is the interceptor's refusal, and is what D3 asks for.
     *
     * 403 is accepted alongside it for the routes already gated by
     * `@RequiresCapability` at the class level — `/audit/export` reaches the
     * capability guard first, and guards run before interceptors. That refusal
     * is not learner-specific (a tutor gets the same 403), so it discloses
     * nothing about the caller's role that the API documentation does not
     * already state.
     */
    it.each(DENIED_TO_LEARNERS)('%s %s is refused', async (method, route) => {
      const res = await request(app.getHttpServer())
        [method.toLowerCase() as 'get'](route)
        .set(asA());

      expect([403, 404]).toContain(res.status);
    });

    it.each(DENIED_TO_LEARNERS)(
      '%s %s still works for provider staff',
      async (method, route) => {
        const res = await request(app.getHttpServer())
          [method.toLowerCase() as 'get'](route)
          .set(ctx.staffHeaders);

        // The point is only that staff are not caught by the learner refusal.
        expect(res.status).not.toBe(404);
      },
    );

    it("GET /apprentices/:id does not return another learner's record", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/apprentices/${ctx.learnerB.apprenticeId}`)
        .set(asA());

      expect(res.status).toBe(404);
    });

    it("GET /learners/:enrolmentId/profile does not return another learner's profile", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${ctx.learnerB.enrolmentId}/profile`)
        .set(asA());

      expect(res.status).toBe(404);
    });

    /**
     * The presign route checked `belongsToOrganisation(key, organisationId)`
     * only — the `learners/{apprenticeId}` segment of the key was never
     * compared against the caller, so a learner who had seen another learner's
     * apprentice id (and the cohort table handed it out) could mint a download
     * URL for their evidence.
     */
    it("POST /storage/download-url refuses another learner's evidence key", async () => {
      const key = `orgs/${ctx.providerOrgId}/learners/${ctx.learnerB.apprenticeId}/evidence/${NON_EXISTENT_UUID}/private.pdf`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/storage/download-url')
        .set(asA())
        .send({ key });

      expect([400, 403, 404]).toContain(res.status);
    });
  });

  /**
   * Routes a learner legitimately uses. These are not refused — they are
   * narrowed to the caller's own rows, which is a different guarantee and
   * needs its own evidence.
   */
  describe('routes a learner reaches, narrowed to their own rows', () => {
    const SCOPED: ReadonlyArray<
      [
        string,
        string,
        'marker' | 'reviewMarker' | 'evidenceMarker' | 'enrolmentId',
      ]
    > = [
      ['OTJ sessions', '/api/v1/otj-log-entries', 'marker'],
      ['reviews', '/api/v1/reviews', 'reviewMarker'],
      ['portfolio evidence', '/api/v1/ksb-evidence-items', 'evidenceMarker'],
      ['enrolments', '/api/v1/enrolments', 'enrolmentId'],
    ];

    it.each(SCOPED)(
      '%s: staff see both learners (proves the marker is in this response shape)',
      async (_label, route, field) => {
        const res = await request(app.getHttpServer())
          .get(route)
          .set(ctx.staffHeaders)
          .expect(200);

        const body = bodyOf(res);
        expect(body).toContain(ctx.learnerA[field]);
        expect(body).toContain(ctx.learnerB[field]);
      },
    );

    it.each(SCOPED)(
      '%s: learner A sees their own row',
      async (_label, route, field) => {
        const res = await request(app.getHttpServer())
          .get(route)
          .set(asA())
          .expect(200);

        expect(bodyOf(res)).toContain(ctx.learnerA[field]);
      },
    );

    it.each(SCOPED)(
      '%s: learner A does not see learner B',
      async (_label, route, field) => {
        const res = await request(app.getHttpServer())
          .get(route)
          .set(asA())
          .expect(200);

        expect(bodyOf(res)).not.toContain(ctx.learnerB[field]);
      },
    );

    it("GET /enrolments/:id does not return another learner's enrolment", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/enrolments/${ctx.learnerB.enrolmentId}`)
        .set(asA());
      expect(res.status).toBe(404);
    });

    it("GET /enrolments/:id/journey does not return another learner's pace", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/enrolments/${ctx.learnerB.enrolmentId}/journey`)
        .set(asA());
      expect(res.status).toBe(404);
    });

    it("GET /reviews/:id does not return another learner's review", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/reviews/${ctx.learnerB.reviewId}`)
        .set(asA());
      expect(res.status).toBe(404);
    });

    it("GET /ksb-evidence-items/:id does not return another learner's evidence", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/ksb-evidence-items/${ctx.learnerB.evidenceId}`)
        .set(asA());
      expect(res.status).toBe(404);
    });

    it("GET /portfolio/ksb-heatmap does not return another learner's heatmap", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/portfolio/ksb-heatmap')
        .query({ enrolmentId: ctx.learnerB.enrolmentId })
        .set(asA());
      expect(res.status).toBe(404);
    });

    it('learner A can still read their own enrolment and journey', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/enrolments/${ctx.learnerA.enrolmentId}`)
        .set(asA())
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/enrolments/${ctx.learnerA.enrolmentId}/journey`)
        .set(asA())
        .expect(200);
    });

    it('learner A can still read their own review and evidence', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/reviews/${ctx.learnerA.reviewId}`)
        .set(asA())
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/ksb-evidence-items/${ctx.learnerA.evidenceId}`)
        .set(asA())
        .expect(200);
    });
  });

  describe('existence disclosure', () => {
    /**
     * D3: "Error and status responses must not differ between 'record does not
     * exist' and 'record exists but is not yours'." Compared on status AND on
     * message, because identical statuses with different bodies leak just as
     * effectively.
     */
    /**
     * Each row carries its own id accessor rather than a label-keyed lookup.
     * The accessor is a thunk because `ctx` is not populated until `beforeAll`
     * has run, and the table is built at describe time.
     */
    const INDISTINGUISHABLE: ReadonlyArray<
      [string, (id: string) => string, () => string]
    > = [
      [
        'OTJ entry',
        (id) => `/api/v1/otj-log-entries/${id}`,
        () => ctx.learnerB.submittedOtjEntryId,
      ],
      [
        'enrolment',
        (id) => `/api/v1/enrolments/${id}`,
        () => ctx.learnerB.enrolmentId,
      ],
      ['review', (id) => `/api/v1/reviews/${id}`, () => ctx.learnerB.reviewId],
      [
        'portfolio evidence',
        (id) => `/api/v1/ksb-evidence-items/${id}`,
        () => ctx.learnerB.evidenceId,
      ],
      [
        'apprentice record',
        (id) => `/api/v1/apprentices/${id}`,
        () => ctx.learnerB.apprenticeId,
      ],
    ];

    it.each(INDISTINGUISHABLE)(
      'a %s that is not mine is indistinguishable from one that does not exist',
      async (_label, route, idOf) => {
        const targetId = idOf();
        const notMine = await request(app.getHttpServer())
          .get(route(targetId))
          .set(asA());
        const notReal = await request(app.getHttpServer())
          .get(route(NON_EXISTENT_UUID))
          .set(asA());

        expect(notMine.status).toBe(notReal.status);

        /**
         * The requested id is substituted out before comparing. Nest's own
         * unmatched-route message embeds the path, and the refusal mirrors it
         * — so the two messages differ by the id the caller themselves chose,
         * which discloses nothing. What must not differ is anything else.
         */
        const normalise = (res: request.Response, id: string) =>
          ((res.body as { message?: string }).message ?? '').replace(id, ':id');

        expect(normalise(notMine, targetId)).toBe(
          normalise(notReal, NON_EXISTENT_UUID),
        );
      },
    );
  });

  describe('cross-tenant (an unrelated provider)', () => {
    const crossTenantRoutes = [
      '/api/v1/apprentices',
      '/api/v1/learners/cohort',
      '/api/v1/enrolments',
      '/api/v1/reviews',
      '/api/v1/ksb-evidence-items',
      '/api/v1/otj-log-entries',
    ];

    it.each(crossTenantRoutes)(
      '%s leaks nothing from the other organisation',
      async (route) => {
        const res = await request(app.getHttpServer())
          .get(route)
          .set(strangerHeaders);

        const body = bodyOf(res);
        for (const learner of [ctx.learnerA, ctx.learnerB]) {
          expect(body).not.toContain(learner.apprenticeId);
          expect(body).not.toContain(learner.enrolmentId);
          expect(body).not.toContain(learner.marker);
          expect(body).not.toContain(learner.reviewMarker);
          expect(body).not.toContain(learner.evidenceMarker);
        }
      },
    );

    it.each([
      [
        'OTJ entry',
        (c: ILearnerScopeContext) =>
          `/api/v1/otj-log-entries/${c.learnerA.submittedOtjEntryId}`,
      ],
      [
        'enrolment',
        (c: ILearnerScopeContext) =>
          `/api/v1/enrolments/${c.learnerA.enrolmentId}`,
      ],
      [
        'review',
        (c: ILearnerScopeContext) => `/api/v1/reviews/${c.learnerA.reviewId}`,
      ],
      [
        'evidence',
        (c: ILearnerScopeContext) =>
          `/api/v1/ksb-evidence-items/${c.learnerA.evidenceId}`,
      ],
    ])("refuses another organisation's %s by id", async (_label, route) => {
      const res = await request(app.getHttpServer())
        .get(route(ctx))
        .set(strangerHeaders);
      expect([403, 404]).toContain(res.status);
    });
  });

  /**
   * Paths that already scoped by the authenticated principal before this work.
   * Asserted rather than assumed, because "appears correctly scoped" is not a
   * clearance.
   */
  describe('paths already scoped by principal keep working for the learner', () => {
    it('GET /learners/me/summary returns the learner their own enrolment', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/learners/me/summary')
        .set(asA())
        .expect(200);

      const data = (res.body as { data: { activeEnrolmentId: string | null } })
        .data;
      expect(data.activeEnrolmentId).toBe(ctx.learnerA.enrolmentId);
    });

    it('GET /learners/me/documents is reachable and scoped to the caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/learners/me/documents')
        .set(asA())
        .expect(200);

      expect(bodyOf(res)).not.toContain(ctx.learnerB.enrolmentId);
    });

    it('GET /notifications returns only the learner own notifications', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set(asA())
        .expect(200);

      expect(bodyOf(res)).not.toContain(ctx.learnerB.marker);
    });

    /**
     * `organisations.service.findAll()` takes no arguments and runs a bare
     * `repository.find({})` — every organisation on the platform. It is scoped
     * entirely by the Postgres policy `organisations_select`:
     *
     *   USING (app_rls_bootstrap() OR id = app_current_org()
     *          OR app_user_member_of_org(id))
     *
     * So it is correct, but only because the connection is `graddly_app`.
     * Under the superuser that dev connects as, RLS is not enforced and this
     * returns the whole platform. Asserted here rather than reasoned about,
     * because the e2e suite is the only place that runs as the app role.
     *
     * The learner-scope interceptor cannot help here: this controller has no
     * `ActiveOrganisationGuard`, so `user.organisationId` is never resolved and
     * the interceptor is a deliberate no-op.
     */
    it('GET /organisations is scoped to the learner own memberships by RLS', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/organisations')
        .set(asA())
        .expect(200);

      const body = bodyOf(res);
      expect(body).toContain(ctx.providerOrgId);
      expect(body).not.toContain(strangerHeaders[ORGANISATION_ID_HEADER]);
    });

    it('GET /messaging/threads returns only threads the learner participates in', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/messaging/threads')
        .set(asA())
        .expect(200);

      expect(bodyOf(res)).not.toContain(ctx.learnerB.userId);
      expect(bodyOf(res)).not.toContain(ctx.learnerB.enrolmentId);
    });
  });
});
