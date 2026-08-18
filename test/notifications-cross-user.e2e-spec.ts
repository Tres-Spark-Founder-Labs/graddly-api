import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { NotificationType } from '../src/notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createAppDbClient, createE2ePgClient } from './helpers/rls-db.js';

import type { App } from 'supertest/types';

/**
 * F3.4.3 AC1 — "notifications appear in the notification centre" — asserted from
 * the only angle that can fail: a notification written **for somebody other than
 * the person who caused it**.
 *
 * ── WHY THIS SUITE EXISTS ───────────────────────────────────────────────────
 *
 * `notifications_insert` used to be `WITH CHECK (app_rls_bootstrap() OR
 * "userId" = app_current_user())`. Since a notification exists to tell someone
 * else something, that check failed at essentially every call site, and no test
 * in the suite noticed — because none of them wrote a notification to anyone but
 * the acting user.
 *
 * The observable damage was not a missing notification. Approving an
 * off-the-job log returned **HTTP 500 while the approval committed**: the failed
 * INSERT aborted the transaction, a bare `catch {}` swallowed the 42501, and the
 * next query on the poisoned connection raised 25P02.
 *
 * ── WHY IT CONNECTS AS `graddly_app` ────────────────────────────────────────
 *
 * The row-count probes use `createAppDbClient()`, the NOSUPERUSER NOBYPASSRLS
 * role the deployed application uses. Connecting as the migration role would
 * make every assertion pass regardless of the policy, because Postgres does not
 * apply RLS to a superuser at all — which is precisely how this survived.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 *
 * Request-scoped paths only. `ReviewsReminderService` runs from cron with no
 * organisation and is a separate, still-open defect; nothing here covers it.
 */
describe('Notifications written to a third party (F3.4.3 AC1)', () => {
  let app: INestApplication<App>;
  let appDb: Client;

  beforeAll(async () => {
    app = await createE2eApp();
    appDb = createAppDbClient();
    await appDb.connect();
  });

  afterAll(async () => {
    await appDb?.end();
    await app?.close();
  });

  /**
   * Grants the membership a real apprentice gets on accepting their invitation
   * (`invitations.service.ts:250`, role MEMBER of the provider organisation).
   *
   * Inserted directly rather than driven through the invitation endpoint, which
   * needs an email round trip. The row shape is identical.
   */
  const grantMembership = async (userId: string, orgId: string) => {
    const sudo = createE2ePgClient();
    await sudo.connect();
    try {
      await sudo.query(
        `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [orgId, userId],
      );
    } finally {
      await sudo.end();
    }
  };

  /** Counts as the application role, so RLS applies exactly as in production. */
  const countNotificationsFor = async (userId: string): Promise<number> => {
    // Bootstrap purely to *observe*. The write under test is unbootstrapped;
    // without this the probe could not see rows it is not addressed to and
    // would report 0 whether the fix worked or not.
    await appDb.query(`SELECT set_config('app.rls_bootstrap','1',false)`);
    const res = await appDb.query<{ count: string }>(
      `SELECT count(*) FROM notifications WHERE "userId" = $1 AND "isDeleted" = false`,
      [userId],
    );
    await appDb.query(`SELECT set_config('app.rls_bootstrap','0',false)`);
    return Number(res.rows[0].count);
  };

  it('an employer approving an OTJ log notifies the apprentice, not the approver', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `notif-owner-${suffix}@example.com`,
    });
    const apprenticeUser = await createVerifiedUser(app, {
      email: `notif-apprentice-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Notif Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const asOwner = (method: 'post' | 'patch', url: string) =>
      request(app.getHttpServer())
        [method](url)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId);

    const programmeRes = await asOwner('post', '/api/v1/programmes')
      .send({
        code: `NOTIF-PROG-${suffix}`,
        title: 'Notif Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await asOwner('post', '/api/v1/standards')
      .send({
        programmeId,
        code: `NOTIF-STD-${suffix}`,
        title: 'Notif Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await asOwner('post', '/api/v1/apprentices')
      .send({
        firstName: 'Notif',
        lastName: 'Apprentice',
        email: apprenticeUser.email,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await asOwner('post', '/api/v1/enrolments')
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    // Without a linked portal account `notifyApprenticeOfDecision` returns
    // early and the test would pass while proving nothing.
    await asOwner('patch', `/api/v1/enrolments/${enrolmentId}/participants`)
      .send({ apprenticeUserId: apprenticeUser.userId })
      .expect(200);

    // The apprentice has accepted their invitation (PRD F1.2.5 AC3 -> AC5
    // "account created" -> member). Without this they are mid-journey and
    // correctly receive nothing; that path has its own test below.
    await grantMembership(apprenticeUser.userId, orgId);

    await asOwner('post', `/api/v1/enrolments/${enrolmentId}/activate`).expect(
      201,
    );

    const entryRes = await asOwner('post', '/api/v1/otj-log-entries')
      .send({
        enrolmentId,
        apprenticeId,
        loggedDate: new Date().toISOString().slice(0, 10),
        minutes: 120,
        activityName: 'Cross-user notification probe',
        category: 'taught_learning',
      })
      .expect(201);
    const entryId = (entryRes.body as { data: { id: string } }).data.id;

    // draft -> submitted through the API. A direct repository write from the
    // test has no tenant context and is silently blocked by RLS.
    await asOwner('patch', `/api/v1/otj-log-entries/${entryId}`)
      .send({ status: 'submitted' })
      .expect(200);

    const before = await countNotificationsFor(apprenticeUser.userId);

    const approveRes = await asOwner(
      'post',
      '/api/v1/otj-log-entries/bulk-approve',
    ).send({ ids: [entryId] });

    /**
     * The approval must not merely avoid throwing — it must report success.
     * Before the fix this was a 500 *after* the approval had committed, which
     * is the worst of both outcomes.
     */
    expect(approveRes.status).toBe(201);
    const body = approveRes.body as {
      data: {
        succeeded: number;
        results: { ok: boolean; notificationQueued: boolean }[];
      };
    };
    expect(body.data.succeeded).toBe(1);

    // The service's own report that the learner was told. It was `false` for
    // every approval before the policy fix.
    expect(body.data.results[0].notificationQueued).toBe(true);

    const after = await countNotificationsFor(apprenticeUser.userId);
    expect(after).toBe(before + 1);

    /**
     * The approver gets no *OTJ* notification. Scoped by type on purpose: the
     * owner is a provider admin and legitimately receives the "enrolment
     * pending provider acceptance" notice from activation, so an unqualified
     * count of zero here would be asserting the wrong thing.
     */
    await appDb.query(`SELECT set_config('app.rls_bootstrap','1',false)`);
    const ownerOtj = await appDb.query<{ count: string }>(
      `SELECT count(*) FROM notifications WHERE "userId" = $1 AND type = 'otj' AND "isDeleted" = false`,
      [owner.userId],
    );
    await appDb.query(`SELECT set_config('app.rls_bootstrap','0',false)`);
    expect(Number(ownerOtj.rows[0].count)).toBe(0);
  });

  /**
   * The co-sign loop (`reviews-co-sign.service.ts:185`) writes three
   * notifications from a single actor — apprentice, tutor and employer manager.
   * Under the old user-keyed insert policy exactly one survived, whichever
   * happened to be the signer, so a partial success looked like a whole one.
   *
   * ── WHY THIS DRIVES THE SERVICE, NOT THE SIGNING CEREMONY ─────────────────
   *
   * Reaching `notifyCompletion` through HTTP needs a generated and processed
   * snapshot PDF, three ordered signatures, and an esignature record resolved
   * against each signer's *active* organisation. That fixture is larger than the
   * behaviour under test and fails for reasons that have nothing to do with
   * notifications.
   *
   * The property that regressed is "one actor writes to three different
   * recipients in one loop", and that is what is asserted here. The end-to-end
   * path through an HTTP request is already covered by the OTJ approval test
   * above, which does drive a real controller.
   */
  it('writes a notification to each of three recipients, none of them the actor', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `cosign-owner-${suffix}@example.com`,
    });
    /**
     * Created one at a time, and that is load-bearing rather than stylistic.
     *
     * `createE2eApp` calls `app.init()` and never `app.listen()`, so the HTTP
     * server has no address of its own. supertest binds one lazily, per request
     * (`supertest/lib/test.js:61`):
     *
     *     const addr = app.address();
     *     if (!addr) this._server = app.listen(0);
     *
     * Run concurrently, several requests each observe a null address and race
     * to bind the same server; the losers then talk to a socket that is still
     * coming up. That surfaces as `connect ECONNRESET` with no assertion
     * failure, because nothing was ever asserted — the transport died first.
     * `createVerifiedUser` is two HTTP round trips, so three in parallel was six
     * requests into that race.
     *
     * It is timing-dependent, which is why it passed locally and failed 419
     * seconds into a loaded shared runner. This was the only suite in the
     * repository using `Promise.all`; the other 79 are sequential, which is why
     * this was the only one that reset.
     */
    const recipients: Awaited<ReturnType<typeof createVerifiedUser>>[] = [];
    for (const tag of ['a', 't', 'm']) {
      recipients.push(
        await createVerifiedUser(app, {
          email: `cosign-${tag}-${suffix}@example.com`,
        }),
      );
    }

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Cosign Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    for (const r of recipients) {
      await grantMembership(r.userId, orgId);
    }

    /**
     * Sequential for a second, independent reason: `countNotificationsFor`
     * runs on the shared `appDb` client, and a `pg.Client` — unlike a `Pool` —
     * serves one query at a time. Overlapping calls on it are deprecated
     * outright ("Calling client.query() when the client is already executing a
     * query"), and worse, each call brackets its read between
     * `app.rls_bootstrap` 1 and 0. Interleaved, one call clears the flag while
     * another is still reading, so the reader is refused its own rows by RLS
     * and reports 0. The count would have been quietly wrong rather than
     * loudly broken.
     */
    const before: number[] = [];
    for (const r of recipients) {
      before.push(await countNotificationsFor(r.userId));
    }

    const notifications = app.get(NotificationsService);
    for (const r of recipients) {
      const written = await notifications.createForUser({
        userId: r.userId,
        organisationId: orgId,
        type: NotificationType.REVIEW,
        title: 'Review completed',
        body: 'Review has been fully signed.',
      });
      // Every one must land, not just the last.
      expect(written).not.toBeNull();
    }

    const after: number[] = [];
    for (const r of recipients) {
      after.push(await countNotificationsFor(r.userId));
    }
    recipients.forEach((_, i) => {
      expect(after[i]).toBe(before[i] + 1);
    });

    // The actor wrote three notifications and received none.
    expect(await countNotificationsFor(owner.userId)).toBe(0);
  });

  /**
   * PRD F1.2.5 AC1/AC3/AC5 — the pre-membership window is a modelled state.
   *
   * The employer creates the apprentice profile (AC1), the system invites them
   * (AC3), and "invited" and "account created" are tracked as distinct states
   * before membership (AC5). An enrolment can therefore name an
   * `apprenticeUserId` for someone who cannot yet receive a notification.
   *
   * This asserts the CORRECT behaviour for that window: the approval succeeds,
   * no notification is written, and nothing is raised or logged as an error.
   * It is not an expected-failure test.
   */
  it('approving for an invited-but-not-yet-member apprentice succeeds and writes nothing', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `premem-owner-${suffix}@example.com`,
    });
    // Account created (AC3) but invitation not accepted -> no membership.
    const invitee = await createVerifiedUser(app, {
      email: `premem-invitee-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Premem Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const asOwner = (method: 'post' | 'patch', url: string) =>
      request(app.getHttpServer())
        [method](url)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId);

    const programmeRes = await asOwner('post', '/api/v1/programmes')
      .send({
        code: `PM-PROG-${suffix}`,
        title: 'PM Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await asOwner('post', '/api/v1/standards')
      .send({
        programmeId,
        code: `PM-STD-${suffix}`,
        title: 'PM Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await asOwner('post', '/api/v1/apprentices')
      .send({ firstName: 'Pre', lastName: 'Member', email: invitee.email })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await asOwner('post', '/api/v1/enrolments')
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    // Linked, but NOT granted membership. This is the state under test, and
    // the participants endpoint permits it by design (PRD F1.2.5 AC1/AC3).
    await asOwner('patch', `/api/v1/enrolments/${enrolmentId}/participants`)
      .send({ apprenticeUserId: invitee.userId })
      .expect(200);

    await asOwner('post', `/api/v1/enrolments/${enrolmentId}/activate`).expect(
      201,
    );

    const entryRes = await asOwner('post', '/api/v1/otj-log-entries')
      .send({
        enrolmentId,
        apprenticeId,
        loggedDate: new Date().toISOString().slice(0, 10),
        minutes: 60,
        activityName: 'Pre-membership probe',
        category: 'taught_learning',
      })
      .expect(201);
    const entryId = (entryRes.body as { data: { id: string } }).data.id;

    await asOwner('patch', `/api/v1/otj-log-entries/${entryId}`)
      .send({ status: 'submitted' })
      .expect(200);

    const approveRes = await asOwner(
      'post',
      '/api/v1/otj-log-entries/bulk-approve',
    ).send({ ids: [entryId] });

    // The approval itself must succeed — the learner not being contactable yet
    // has nothing to do with whether their hours count.
    expect(approveRes.status).toBe(201);
    const body = approveRes.body as {
      data: {
        succeeded: number;
        results: { ok: boolean; notificationQueued: boolean }[];
      };
    };
    expect(body.data.succeeded).toBe(1);
    expect(body.data.results[0].ok).toBe(true);

    // Reported honestly as "not queued" rather than pretended.
    expect(body.data.results[0].notificationQueued).toBe(false);

    // And nothing was written.
    expect(await countNotificationsFor(invitee.userId)).toBe(0);
  });
});
