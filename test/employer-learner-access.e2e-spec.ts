import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import {
  createLearnerScopeContext,
  type ILearnerScopeContext,
} from './helpers/learner-scope-e2e.js';

import type { App } from 'supertest/types';

/**
 * An employer can reach their own apprentices, and nobody else's.
 *
 * ── WHAT THIS COVERS ────────────────────────────────────────────────────────
 *
 * F1.2.1 and F1.2.2 are Phase 1 Must Haves on the employer portal and both
 * failed for every employer account:
 *
 *   GET /apprentices                  filtered on the Apprentice's own
 *                                     organisationId, which is the provider's,
 *                                     so the roster was empty by construction
 *   GET /learners/:id/profile         asserted PROVIDER outright, so an
 *                                     employer got 403 on their own learner
 *
 * ── WHY THE ISOLATION HALF MATTERS MORE ─────────────────────────────────────
 *
 * Both fixes widen a query. A widened query that leaks across tenants is far
 * worse than the empty roster it replaces: an empty screen is visibly broken
 * and gets reported, whereas one extra learner in a list of thirty is not
 * noticed by anyone, and it is another employer's employee.
 *
 * So every "can read" assertion below is paired with a "cannot", and the
 * sharpest case is deliberately the near miss — a learner at the *same
 * provider* whose employer is somebody else. A fix that widened to "any
 * apprentice my provider teaches" would pass every other test here.
 */
describe('Employer access to apprentices and learner profiles (e2e)', () => {
  let app: INestApplication<App>;

  /** Provider A, Employer A, learners A and B. */
  let mine: ILearnerScopeContext;
  /** A wholly separate provider and employer. */
  let theirs: ILearnerScopeContext;

  /** learnerA's tutor: a member of the provider's organisation, and nothing else. */
  let tutorUserId: string;
  const TUTOR_NAME = 'Rowan Tutor';

  /** learnerB, reassigned to the *other* employer but still at provider A. */
  let sameProviderOtherEmployerEnrolmentId: string;
  let sameProviderOtherEmployerApprenticeId: string;

  const employerHeaders = (ctx: ILearnerScopeContext) => ({
    ...ctx.staffHeaders,
    [ORGANISATION_ID_HEADER]: ctx.employerOrgId,
  });

  const rosterIds = async (
    headers: Record<string, string>,
  ): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/apprentices?perPage=100')
      .set(headers)
      .expect(200);
    const body = res.body as { data: { id: string }[] };
    return body.data.map((a) => a.id);
  };

  beforeAll(async () => {
    app = await createE2eApp();
    mine = await createLearnerScopeContext(app, 'mine');
    theirs = await createLearnerScopeContext(app, 'theirs');

    /*
     * The near miss. learnerB stays at provider A — same standard, same tutor,
     * same everything — but the enrolment now names the other employer.
     *
     * Written straight to the database because there is no endpoint for
     * reassigning an employer mid-enrolment, and the transfer flow is not what
     * is under test. What matters is the resulting row shape.
     */
    sameProviderOtherEmployerEnrolmentId = mine.learnerB.enrolmentId;
    sameProviderOtherEmployerApprenticeId = mine.learnerB.apprenticeId;
    await mine.sudo.query(
      `UPDATE enrolments SET "employerOrganisationId" = $1 WHERE id = $2`,
      [theirs.employerOrgId, sameProviderOtherEmployerEnrolmentId],
    );
    /*
     * A tutor for learnerA.
     *
     * `mine.staffUserId` cannot stand in for one. The fixture's owner creates
     * both organisations, so they hold a membership of the employer org too,
     * and `app_user_in_current_org` would then admit them to the employer for
     * the wrong reason — the tutor assertion below would pass with the
     * employer's read still broken. This user is a plain member of the
     * PROVIDER's organisation and of nothing else, which is what a tutor is in
     * this schema.
     */
    const tutor = await createVerifiedUser(app, {
      firstName: 'Rowan',
      lastName: 'Tutor',
      email: `employer-access-tutor-${Date.now()}@example.com`,
    });
    tutorUserId = tutor.userId;
    await mine.sudo.query(
      `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
       VALUES ($1, $2, 'member', 'active')`,
      [mine.providerOrgId, tutorUserId],
    );
    await mine.sudo.query(
      `UPDATE enrolments SET "tutorUserId" = $1 WHERE id = $2`,
      [tutorUserId, mine.learnerA.enrolmentId],
    );

    /*
     * learnerA's portfolio item, accepted, so the document library has
     * something it could include. The fixture creates it as `draft` and
     * `listForEnrolment` picks up only `accepted` — asserting the employer
     * cannot see a draft row would pass whether or not the row policy held.
     */
    await mine.sudo.query(
      `UPDATE ks_evidence_items
          SET status = 'accepted', "acceptedAt" = NOW()
        WHERE id = $1`,
      [mine.learnerA.evidenceId],
    );

    /*
     * Two whole tenants, where every other spec using this fixture builds one.
     * Cross-tenant isolation cannot be asserted from inside a single tenant, so
     * the second context is the price of the property under test rather than
     * waste — and it puts this hook well over the suite's 60s default.
     * learner-scope-surface already carries 180_000 for one context plus a
     * stranger org; this is roughly double that work.
     */
  }, 300_000);

  afterAll(async () => {
    // Optional throughout: when beforeAll fails none of these exist, and an
    // afterAll that throws replaces the real failure with a TypeError.
    await mine?.sudo?.end();
    await theirs?.sudo?.end();
    await app?.close();
  });

  describe('GET /apprentices as an employer', () => {
    it('returns the apprentices on their own enrolments', async () => {
      const ids = await rosterIds(employerHeaders(mine));

      // The whole point: this list used to be empty for every employer.
      expect(ids).toContain(mine.learnerA.apprenticeId);
    });

    it('excludes a learner at the same provider under another employer', async () => {
      const ids = await rosterIds(employerHeaders(mine));

      // learnerB is still taught by provider A. Only the employer changed, and
      // that is the only thing that should decide this.
      expect(ids).not.toContain(sameProviderOtherEmployerApprenticeId);
    });

    it('excludes another employer’s apprentices entirely', async () => {
      const ids = await rosterIds(employerHeaders(mine));

      expect(ids).not.toContain(theirs.learnerA.apprenticeId);
      expect(ids).not.toContain(theirs.learnerB.apprenticeId);
    });

    it('still scopes a provider to the apprentices it owns', async () => {
      const ids = await rosterIds(mine.staffHeaders);

      // No regression: the provider keeps both, including the one whose
      // employer moved — they are still teaching that learner.
      expect(ids).toContain(mine.learnerA.apprenticeId);
      expect(ids).toContain(sameProviderOtherEmployerApprenticeId);
      // And gains nothing from the other provider.
      expect(ids).not.toContain(theirs.learnerA.apprenticeId);
    });
  });

  /*
   * ── THREE LAYERS HAD TO AGREE ──────────────────────────────────────────────
   *
   * These were skipped while the endpoint could only answer an employer with a
   * 500, which would have been worse than the 403 it replaced. Three separate
   * things were wrong, and fixing any one of them alone still failed:
   *
   *   authorisation  assertPortalType(PROVIDER) refused every employer
   *                  outright, before this enrolment was ever considered
   *   scoping        eight sub-reads filtered on the CALLER's organisationId,
   *                  so an admitted employer got an empty profile, not a 403
   *   row policies   standards and intervention_actions were owner-only, so
   *                  enrolment.standard came back null under graddly_app and
   *                  the aggregate threw on .title
   *
   * The third is invisible on a dev database, which connects as a superuser
   * for whom RLS is not enforced. These run as graddly_app (DB_USERNAME in
   * .env.test — NOSUPERUSER, NOBYPASSRLS), so the policies are genuinely
   * exercised rather than bypassed. Only the fixture writes and the migrations
   * use postgres.
   *
   * See docs/employer-learner-access.md.
   */
  describe('GET /learners/:enrolmentId/profile as an employer', () => {
    it('returns the profile of their own learner', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${mine.learnerA.enrolmentId}/profile`)
        .set(employerHeaders(mine))
        .expect(200);

      const body = res.body as {
        data: { enrolmentId: string; personal: { firstName: string } };
      };
      // Previously a flat 403 — this is F1.2.2's entire response payload.
      expect(body.data.enrolmentId).toBe(mine.learnerA.enrolmentId);
      expect(body.data.personal.firstName).toBeTruthy();
    });

    it('refuses a learner at the same provider under another employer', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/learners/${sameProviderOtherEmployerEnrolmentId}/profile`)
        .set(employerHeaders(mine))
        .expect(404);
    });

    it('refuses another employer’s learner', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/learners/${theirs.learnerA.enrolmentId}/profile`)
        .set(employerHeaders(mine))
        .expect(404);
    });

    it('answers 404 rather than 403 for an enrolment the caller cannot read', async () => {
      // A 403 would confirm the id exists, which is a membership oracle: an
      // employer could enumerate ids and learn which belong to real enrolments
      // at organisations they have nothing to do with.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${theirs.learnerB.enrolmentId}/profile`)
        .set(employerHeaders(mine));

      expect(res.status).toBe(404);
      expect(res.status).not.toBe(403);
    });

    it('still serves the provider that owns the enrolment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${mine.learnerA.enrolmentId}/profile`)
        .set(mine.staffHeaders)
        .expect(200);

      const body = res.body as { data: { enrolmentId: string } };
      expect(body.data.enrolmentId).toBe(mine.learnerA.enrolmentId);
    });

    it('still refuses a provider another provider’s learner', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/learners/${theirs.learnerA.enrolmentId}/profile`)
        .set(mine.staffHeaders)
        .expect(404);
    });

    /**
     * F1.2.2 AC1 — "personal details (name, start date, standard, provider,
     * tutor, line manager)".
     *
     * The six cases above assert `enrolmentId` and `personal.firstName`, and
     * that is exactly how the tutor stayed null through eleven green tests:
     * nothing asserted the rest of the payload. `users_select` admits
     * `app_user_in_current_org(id)`, the tutor belongs to the *provider's*
     * organisation, and so the employer received a non-null `tutor.userId`
     * beside a null `tutor.name` — a field the AC names, absent, with nothing
     * anywhere reporting an error.
     *
     * The name is now hydrated by `LearnerMetricsService.loadTutorNames` under
     * the RLS bootstrap flag, the shape `loadEmployerContacts` in the same
     * aggregate already used. See `docs/employer-learner-access.md`,
     * "Bootstrap is for display names".
     */
    it('carries the tutor’s name, not only their id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${mine.learnerA.enrolmentId}/profile`)
        .set(employerHeaders(mine))
        .expect(200);

      const body = res.body as {
        data: { tutor: { userId: string | null; name: string | null } };
      };
      expect(body.data.tutor.userId).toBe(tutorUserId);
      expect(body.data.tutor.name).toBe(TUTOR_NAME);
    });

    it('shows the provider the same tutor it shows the employer', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/learners/${mine.learnerA.enrolmentId}/profile`)
        .set(mine.staffHeaders)
        .expect(200);

      const body = res.body as { data: { tutor: { name: string | null } } };
      // The bootstrap window replaced a read the provider was already allowed
      // to make, so the provider's own answer must not have moved.
      expect(body.data.tutor.name).toBe(TUTOR_NAME);
    });

    /**
     * F1.2.2 AC5 against F2.2.4 AC4 — the one point where the PRD specifies
     * the two learner profiles differently.
     *
     *   F1.2.2 AC5  employer  "all signed agreements, review records, and
     *                         correspondence"
     *   F2.2.4 AC4  tutor     "all signed agreements, review records,
     *                         uploaded evidence"
     *
     * One endpoint serves both, so the employer's narrower library is the
     * specification rather than a gap — and nothing in the code says so.
     * `learner-documents.service.ts` reads accepted evidence for every caller
     * and, since the scoping fix, asks for it under the *provider's*
     * organisationId: the only thing keeping portfolio evidence out of the
     * employer's library is `ks_evidence_items_select` failing to match.
     *
     * Widen that policy for some unrelated reason and F1.2.2's document
     * library changes behaviour with no edit to the profile code. This pair is
     * what fails if anybody does.
     */
    it('keeps portfolio evidence out of the employer’s document library', async () => {
      const documentsFor = async (headers: Record<string, string>) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/learners/${mine.learnerA.enrolmentId}/profile`)
          .set(headers)
          .expect(200);
        const body = res.body as {
          data: { documents: { type: string; title: string }[] };
        };
        return body.data.documents;
      };

      // The provider's library does carry it. Without this half, the employer
      // assertion passes against an empty table and proves nothing.
      const providerDocs = await documentsFor(mine.staffHeaders);
      expect(providerDocs.map((d) => d.type)).toContain('evidence');
      expect(providerDocs.map((d) => d.title)).toContain(
        mine.learnerA.evidenceMarker,
      );

      const employerDocs = await documentsFor(employerHeaders(mine));
      expect(employerDocs.map((d) => d.type)).not.toContain('evidence');
      expect(employerDocs.map((d) => d.title)).not.toContain(
        mine.learnerA.evidenceMarker,
      );
    });
  });

  describe('reads widen, writes do not', () => {
    it('does not let an employer update an apprentice they can now see', async () => {
      // The RLS write policies stayed narrow on purpose (migration
      // 1781100000047 widened SELECT only). An employer reading their own
      // employee is right; an employer editing a record the provider owns is
      // not, and this fix must not have quietly enabled it.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/apprentices/${mine.learnerA.apprenticeId}`)
        .set(employerHeaders(mine))
        .send({ jobTitle: 'Rewritten by the employer' });

      expect([403, 404]).toContain(res.status);
    });
  });
});
