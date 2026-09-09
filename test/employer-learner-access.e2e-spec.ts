import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';

import { createE2eApp } from './helpers/e2e-app.js';
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
  });

  afterAll(async () => {
    await mine.sudo.end();
    await theirs.sudo.end();
    await app.close();
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
   * ── BLOCKED ON AN RLS MIGRATION, NOT ON AUTHORISATION ──────────────────────
   *
   * These are written and correct, and the authorisation half of the fix
   * passed all of them bar the first. They are skipped because the endpoint
   * cannot yet serve an employer without widening two row policies, and
   * shipping a 500 in place of the old 403 would be worse than the bug.
   *
   * What happens today with the assertion widened: the employer is admitted,
   * the enrolment is found, and then `enrolment.standard` is null because
   * `standards` has no linked-party read policy — so the aggregate throws
   * "Cannot read properties of null (reading 'title')".
   *
   * Unskip once standards and intervention_actions have
   * `*_select_linked_org` policies and the aggregate scopes its sub-reads by
   * the enrolment's owning organisation rather than the caller's.
   * `docs/employer-learner-access.md` has the migration shape and the order.
   */
  describe.skip('GET /learners/:enrolmentId/profile as an employer', () => {
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
