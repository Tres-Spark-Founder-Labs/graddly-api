import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * F1.2.1 AC7 — "Table loads within 2 seconds for up to 500 apprentices".
 *
 * Modelled on test/apprentice-roster-pdf-timing.e2e-spec.ts: seed the
 * heaviest roster the PRD names, time it, print the number whether or not the
 * assertion passes, and guard the measurement so it cannot pass on an empty
 * or truncated roster.
 *
 * ── WHAT THE USER WAITS FOR ─────────────────────────────────────────────────
 *
 * The employer opens the roster signed in. Their wait is, in order:
 *
 *   1. GET /auth/me. Serial: the roster queries are disabled until it names
 *      the organisation (`useAuthUser` → `orgId`).
 *   2. Both lists at once, each read in full the way `fetchAllPages` reads it
 *      in the employer portal: page 1 to learn the total, then every other
 *      page in parallel, 100 a page (the API's ceiling, deliberately not
 *      raised — see pagination-query.dto.ts).
 *   3. The client's work: join, filter, sort, render.
 *
 * Steps 1 and 2 are timed here, through the real HTTP stack as `graddly_app`.
 * Step 3 cannot be: Jest has no browser. It is carried as CLIENT_SHARE_MS,
 * measured in Chrome with the employer portal's real modules on the reference
 * laptop (Intel i5-7300U, 2017 dual-core): 539 ms to mount the whole roster
 * screen with 500 apprentices, rounded up to 600. The assertion is that the
 * two together fit in two seconds.
 *
 * Not in the number: network latency and TLS, the portal's /api/proxy hop,
 * and loading the page's JavaScript. On a slower CPU the client share grows
 * fastest — 4.26 s at a 4x slowdown, almost all of it rendering ~17,700 DOM
 * nodes. Virtualising the table is the recorded headroom, not built.
 *
 * If the portal's request pattern changes (fetchAllPages, useApprenticeRoster)
 * this sequence must change with it, or the test times something the user no
 * longer waits for.
 */
describe('F1.2.1 AC7 — the apprentice roster loads within two seconds (e2e)', () => {
  let app: INestApplication<App>;

  const ROSTER_SIZE = 500;
  const NEAR_MISS_SIZE = 20;
  const PER_PAGE = 100;
  const BUDGET_MS = 2_000;
  const CLIENT_SHARE_MS = 600;
  const AUTH_HEADER = 'Authorization';

  beforeAll(async () => {
    app = await createE2eApp();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('serves /auth/me and every page of 500 apprentices and enrolments within the budget left after the client share', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `roster-load-${suffix}@example.com`,
    });
    const auth = { [AUTH_HEADER]: `Bearer ${owner.accessToken}` };

    const createOrg = async (label: string, portalType: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/organisations')
        .set(auth)
        .send({ ...buildOrgPayload(`${label} ${suffix}`), portalType })
        .expect(201);
      return (res.body as { data: { id: string } }).data.id;
    };
    const providerOrgId = await createOrg('Load Provider', 'provider');
    const employerOrgId = await createOrg('Load Employer', 'employer');
    const otherEmployerOrgId = await createOrg('Other Employer', 'employer');
    const provider = { ...auth, [ORGANISATION_ID_HEADER]: providerOrgId };
    const employer = { ...auth, [ORGANISATION_ID_HEADER]: employerOrgId };

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set(provider)
      .send({
        code: `LOAD-PROG-${suffix}`,
        title: 'Roster Load Programme',
        status: 'active',
      })
      .expect(201);
    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set(provider)
      .send({
        programmeId: (programmeRes.body as { data: { id: string } }).data.id,
        code: `LOAD-STD-${suffix}`,
        title: 'Software Developer',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    /**
     * Bulk-seeded as the migration role, as in the PDF timing spec; seeding
     * is not timed. Each apprentice has a portal login, so the enrolment
     * labelling resolves 500 user names as a real roster does; the owner is
     * tutor and line manager throughout.
     */
    const sudo = createE2ePgClient();
    await sudo.connect();
    try {
      const seed = async (
        count: number,
        employerId: string,
        prefix: string,
      ) => {
        await sudo.query(
          `WITH u AS (
               INSERT INTO users ("firstName", "lastName", email, password)
               SELECT $2, lpad(i::text, 3, '0'), $1 || '-u-' || i || '@example.com', 'x'
                 FROM generate_series(1, $3::int) AS i
               RETURNING id, "lastName"
             ), a AS (
               INSERT INTO apprentices ("organisationId", "firstName", "lastName", email, "employeeId", "createdAt")
               SELECT $4, $2, lpad(i::text, 3, '0'), $1 || '-a-' || i || '@example.com',
                      'EMP-' || lpad(i::text, 5, '0'), now() - (i || ' seconds')::interval
                 FROM generate_series(1, $3::int) AS i
               RETURNING id, "lastName"
             )
             INSERT INTO enrolments
               ("organisationId", "apprenticeId", "standardId", status, "employerOrganisationId",
                "apprenticeUserId", "tutorUserId", "employerManagerUserId",
                "otjPaceAlertLevel", "epaDate", "plannedStartDate", "plannedEndDate", "agreedPrice")
             SELECT $4, a.id, $5, 'active', $6, u.id, $7, $7,
                    (ARRAY['on_track','at_risk','off_track'])[(a."lastName"::int % 3) + 1]::otj_pace_alert_level,
                    CASE WHEN a."lastName"::int % 7 = 0 THEN NULL
                         ELSE DATE '2026-10-01' + a."lastName"::int END,
                    DATE '2025-09-01', DATE '2027-03-01', 15000
               FROM a JOIN u ON u."lastName" = a."lastName"`,
          [
            `roster-load-${prefix}-${suffix}`.toLowerCase(),
            prefix,
            count,
            providerOrgId,
            standardId,
            employerId,
            owner.userId,
          ],
        );
      };
      await seed(ROSTER_SIZE, employerOrgId, 'Roster');
      await seed(NEAR_MISS_SIZE, otherEmployerOrgId, 'Stranger');
    } finally {
      await sudo.end();
    }

    type Page = {
      data: Array<{ id: string; apprenticeId?: string; firstName?: string }>;
      meta: { total: number; totalPages: number };
    };
    const getPage = async (path: string, page: number): Promise<Page> => {
      const res = await request(app.getHttpServer())
        .get(path)
        .query({ page, perPage: PER_PAGE })
        .set(employer)
        .expect(200);
      return res.body as Page;
    };
    /**
     * `fetchAllPages`, as the portal runs it — concurrently, because the
     * concurrency is what the user waits on. The sequential-e2e rule allows
     * this where neither of its hazards applies, and neither does:
     * createE2eApp binds its listener once (`app.listen(0)`), so requests
     * cannot race to bind it; and nothing here shares a pg.Client — the app
     * reads through its own pool, and the seeding client above is closed
     * before the first request. The row-count guards below would catch a
     * silently empty read regardless.
     */
    const readAll = async (path: string) => {
      const first = await getPage(path, 1);
      // eslint-disable-next-line no-restricted-syntax -- see readAll
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, first.meta.totalPages - 1) }, (_, i) =>
          getPage(path, i + 2),
        ),
      );
      return {
        total: first.meta.total,
        pages: 1 + rest.length,
        rows: [first, ...rest].flatMap((p) => p.data),
      };
    };

    // Warm the routes once so the number is a load, not a cold start.
    await request(app.getHttpServer()).get('/api/v1/auth/me').set(employer);
    await getPage('/api/v1/apprentices', 1);
    await getPage('/api/v1/enrolments', 1);

    const started = performance.now();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(employer)
      .expect(200);
    const meMs = performance.now() - started;
    // eslint-disable-next-line no-restricted-syntax -- see readAll
    const [apprentices, enrolments] = await Promise.all([
      readAll('/api/v1/apprentices'),
      readAll('/api/v1/enrolments'),
    ]);
    const dataMs = performance.now() - started;
    const totalMs = dataMs + CLIENT_SHARE_MS;

    // eslint-disable-next-line no-console
    console.log(
      `\n[F1.2.1 AC7] roster load for ${ROSTER_SIZE} apprentices: ` +
        `${Math.round(totalMs)} ms of ${BUDGET_MS} ms\n` +
        `  /auth/me:          ${Math.round(meMs)} ms (serial, before the roster requests)\n` +
        `  both lists:        ${Math.round(dataMs - meMs)} ms ` +
        `(${apprentices.pages} + ${enrolments.pages} pages of ${PER_PAGE})\n` +
        `  client share:      ${CLIENT_SHARE_MS} ms (measured in Chrome, not by this test)\n`,
    );

    /**
     * Guards the measurement: the whole roster arrived, every apprentice
     * can be joined to an enrolment (the join the old page-1 read broke),
     * and nothing from the other employer is in it.
     */
    expect(apprentices.total).toBe(ROSTER_SIZE);
    expect(apprentices.rows).toHaveLength(ROSTER_SIZE);
    expect(new Set(apprentices.rows.map((a) => a.id)).size).toBe(ROSTER_SIZE);
    expect(enrolments.rows).toHaveLength(ROSTER_SIZE);
    // Every enrolment seeded in one statement shares a createdAt; without a
    // tie-breaking order the pages overlapped and some never arrived.
    expect(new Set(enrolments.rows.map((e) => e.id)).size).toBe(ROSTER_SIZE);
    const enrolled = new Set(enrolments.rows.map((e) => e.apprenticeId));
    expect(apprentices.rows.every((a) => enrolled.has(a.id))).toBe(true);
    expect(apprentices.rows.some((a) => a.firstName === 'Stranger')).toBe(
      false,
    );

    expect(totalMs).toBeLessThan(BUDGET_MS);
  }, 600_000);
});
