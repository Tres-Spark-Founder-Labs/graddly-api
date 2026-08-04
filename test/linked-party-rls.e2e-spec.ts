import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';

import { createE2eApp } from './helpers/e2e-app.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';
import {
  createAppDbClient,
  createE2ePgClient,
  setTenantGucs,
} from './helpers/rls-db.js';

import type { App } from 'supertest/types';

/**
 * Security hardening pass, item 1 — linked-party read access.
 *
 * WHICH ROLE THIS CONNECTS AS, AND WHY IT MATTERS:
 *
 * Every assertion here runs through `createAppDbClient()`, which connects as
 * `graddly_app` — the NOSUPERUSER role the deployed application uses. It does
 * **not** use `createE2ePgClient()` for reads.
 *
 * That distinction is the entire point of this file. Local development and the
 * Nest e2e app both connect as the `graddly` superuser, for whom row-level
 * security is not enforced at all. Every policy in the database is inert for
 * those connections, so a missing linked-party policy is invisible to an HTTP
 * test, to the dev environment, and to review. The implementation log records
 * this as the reason the F1.2.2 and F1.4.2 bugs survived: "it is invisible in
 * development, because the dev database connects as a superuser that bypasses
 * RLS entirely".
 *
 * Superuser access is used only to *seed* rows, where bypassing RLS is the
 * intent — the fixture has to be able to write rows the app role could not.
 *
 * THE FIXTURE IS THREE ORGANISATIONS, deliberately:
 *   - the owner        (the organisation on the row's `organisationId`)
 *   - the linked party (a party to the enrolment, owning nothing)
 *   - a third party    (related to neither)
 *
 * Two organisations cannot tell "the policy is correct" from "the policy is
 * `USING (true)`". The third organisation is what makes a passing test mean
 * something.
 */
describe('Linked-party RLS (e2e)', () => {
  let app: INestApplication<App>;
  let sudo: Client;
  let appDb: Client;

  let providerOrgId: string;
  let employerOrgId: string;
  let strangerOrgId: string;
  let enrolmentId: string;
  let apprenticeId: string;
  let providerUserId: string;
  let employerUserId: string;
  let strangerUserId: string;

  beforeAll(async () => {
    app = await createE2eApp();

    const linked = await createProviderDirectoryContext(app, 'lprls-linked');
    const stranger = await createProviderDirectoryContext(app, 'lprls-other');

    providerOrgId = linked.providerOrgId;
    employerOrgId = linked.employerOrgId;
    enrolmentId = linked.enrolmentId;
    providerUserId = linked.owner.userId;
    employerUserId = linked.owner.userId;
    strangerOrgId = stranger.providerOrgId;
    strangerUserId = stranger.owner.userId;

    sudo = createE2ePgClient();
    await sudo.connect();

    const row = await sudo.query<{ apprenticeId: string }>(
      `SELECT "apprenticeId" FROM enrolments WHERE id = $1`,
      [enrolmentId],
    );
    apprenticeId = row.rows[0].apprenticeId;

    appDb = createAppDbClient();
    await appDb.connect();
  });

  afterAll(async () => {
    await appDb?.end();
    await sudo?.end();
    await app?.close();
  });

  /** Count visible rows as the application role, under a given tenant. */
  const visibleAs = async (
    orgId: string,
    userId: string,
    sql: string,
    params: unknown[],
  ): Promise<number> => {
    await setTenantGucs(appDb, userId, orgId);
    const res = await appDb.query<{ count: string }>(sql, params);
    return Number(res.rows[0].count);
  };

  describe('review_signatures', () => {
    let signatureId: string;

    beforeAll(async () => {
      const review = await sudo.query<{ id: string }>(
        `INSERT INTO reviews
           ("organisationId", "enrolmentId", "apprenticeId", "scheduledAt", status,
            "apprenticeUserId", "tutorUserId", "employerManagerUserId")
         VALUES ($1, $2, $3, now(), 'scheduled', $4, $4, $5) RETURNING id`,
        [
          providerOrgId,
          enrolmentId,
          apprenticeId,
          providerUserId,
          employerUserId,
        ],
      );
      const inserted = await sudo.query<{ id: string }>(
        `INSERT INTO review_signatures
           ("organisationId", "reviewId", party, status, "signOrder", "signerUserId")
         VALUES ($1, $2, 'tutor', 'pending', 1, $3) RETURNING id`,
        [providerOrgId, review.rows[0].id, providerUserId],
      );
      signatureId = inserted.rows[0].id;
    });

    const countSignature = (orgId: string, userId: string) =>
      visibleAs(
        orgId,
        userId,
        `SELECT count(*) FROM review_signatures WHERE id = $1`,
        [signatureId],
      );

    it('is visible to the owning provider', async () => {
      expect(await countSignature(providerOrgId, providerUserId)).toBe(1);
    });

    /**
     * The gap this test exists to catch.
     *
     * `reviews` and `review_records` both carry a linked-org SELECT policy
     * (migrations 1781100000018 and 1781100000038), so a linked employer can
     * read the review and its full record — but not who signed it. A review
     * whose signature block is empty for the employer reads as "nobody has
     * signed", which is a different and worse statement than "you may not see
     * this".
     */
    it('is visible to the linked employer', async () => {
      expect(await countSignature(employerOrgId, employerUserId)).toBe(1);
    });

    it('is invisible to an unrelated organisation', async () => {
      expect(await countSignature(strangerOrgId, strangerUserId)).toBe(0);
    });

    /** Reads widen; writes must not. */
    it('cannot be written by the linked employer', async () => {
      await setTenantGucs(appDb, employerUserId, employerOrgId);
      const res = await appDb.query(
        `UPDATE review_signatures SET status = 'signed' WHERE id = $1`,
        [signatureId],
      );
      expect(res.rowCount).toBe(0);
    });
  });

  describe('message_threads and messages', () => {
    let threadId: string;
    let messageId: string;

    beforeAll(async () => {
      const thread = await sudo.query<{ id: string }>(
        `INSERT INTO message_threads
           ("organisationId", "enrolmentId", "apprenticeId", "counterpartyParty",
            "apprenticeUserId", "counterpartyUserId")
         VALUES ($1, $2, $3, 'employer_manager', $4, $5) RETURNING id`,
        [
          providerOrgId,
          enrolmentId,
          apprenticeId,
          providerUserId,
          employerUserId,
        ],
      );
      threadId = thread.rows[0].id;

      const message = await sudo.query<{ id: string }>(
        `INSERT INTO messages ("organisationId", "threadId", "senderUserId", body)
         VALUES ($1, $2, $3, 'Checking in on progress') RETURNING id`,
        [providerOrgId, threadId, providerUserId],
      );
      messageId = message.rows[0].id;
    });

    it('thread is visible to the owning organisation', async () => {
      expect(
        await visibleAs(
          providerOrgId,
          providerUserId,
          `SELECT count(*) FROM message_threads WHERE id = $1`,
          [threadId],
        ),
      ).toBe(1);
    });

    /**
     * The second gap.
     *
     * A thread is stamped with the enrolment's owning organisation, but its
     * counterparty is `enrolment.employerManagerUserId` — a user whose active
     * organisation is the *employer*. `MessagingAccessService.isParticipant`
     * authorises them at the service layer, and RLS then returns no rows
     * before that check is ever reached.
     *
     * The failure mode is the one this codebase keeps producing: an empty
     * inbox, indistinguishable from having no messages.
     */
    it('thread is visible to the counterparty employer', async () => {
      expect(
        await visibleAs(
          employerOrgId,
          employerUserId,
          `SELECT count(*) FROM message_threads WHERE id = $1`,
          [threadId],
        ),
      ).toBe(1);
    });

    it('thread is invisible to an unrelated organisation', async () => {
      expect(
        await visibleAs(
          strangerOrgId,
          strangerUserId,
          `SELECT count(*) FROM message_threads WHERE id = $1`,
          [threadId],
        ),
      ).toBe(0);
    });

    it('message body is visible to the counterparty employer', async () => {
      expect(
        await visibleAs(
          employerOrgId,
          employerUserId,
          `SELECT count(*) FROM messages WHERE id = $1`,
          [messageId],
        ),
      ).toBe(1);
    });

    it('message body is invisible to an unrelated organisation', async () => {
      expect(
        await visibleAs(
          strangerOrgId,
          strangerUserId,
          `SELECT count(*) FROM messages WHERE id = $1`,
          [messageId],
        ),
      ).toBe(0);
    });
  });

  describe('apprentices', () => {
    /**
     * The employer is a party to the enrolment and the apprentice is their own
     * employee. Every employer screen that names a learner depends on this
     * row being readable.
     */
    it('is visible to the linked employer', async () => {
      expect(
        await visibleAs(
          employerOrgId,
          employerUserId,
          `SELECT count(*) FROM apprentices WHERE id = $1`,
          [apprenticeId],
        ),
      ).toBe(1);
    });

    it('is invisible to an unrelated organisation', async () => {
      expect(
        await visibleAs(
          strangerOrgId,
          strangerUserId,
          `SELECT count(*) FROM apprentices WHERE id = $1`,
          [apprenticeId],
        ),
      ).toBe(0);
    });
  });

  describe('employer_visit_learners', () => {
    let linkId: string;

    beforeAll(async () => {
      const visit = await sudo.query<{ id: string }>(
        `INSERT INTO employer_visits
           ("organisationId", "employerOrganisationId", "visitedOn", "visitType",
            attendees, "discussionPoints")
         VALUES ($1, $2, CURRENT_DATE, 'on_site', 'Ops manager', 'Progress')
         RETURNING id`,
        [providerOrgId, employerOrgId],
      );
      const link = await sudo.query<{ id: string }>(
        `INSERT INTO employer_visit_learners ("organisationId", "visitId", "enrolmentId")
         VALUES ($1, $2, $3) RETURNING id`,
        [providerOrgId, visit.rows[0].id, enrolmentId],
      );
      linkId = link.rows[0].id;
    });

    /**
     * `employer_visits` already carries an employer SELECT policy (migration
     * 1781100000044). The join table naming the learners discussed does not,
     * so the employer sees a visit that apparently discussed nobody.
     */
    it('is visible to the visited employer', async () => {
      expect(
        await visibleAs(
          employerOrgId,
          employerUserId,
          `SELECT count(*) FROM employer_visit_learners WHERE id = $1`,
          [linkId],
        ),
      ).toBe(1);
    });

    it('is invisible to an unrelated organisation', async () => {
      expect(
        await visibleAs(
          strangerOrgId,
          strangerUserId,
          `SELECT count(*) FROM employer_visit_learners WHERE id = $1`,
          [linkId],
        ),
      ).toBe(0);
    });
  });
});
