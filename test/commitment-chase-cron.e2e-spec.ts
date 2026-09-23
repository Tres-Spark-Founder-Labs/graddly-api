import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { CommitmentChaseService } from '../src/commitments/commitment-chase.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { CommitmentChaseCronService } from '../src/scheduler/commitment-chase-cron.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { App } from 'supertest/types';

/**
 * F3.4.1 AC6 and F4.3.2 AC4 — the seven-day chase on an unsigned commitment
 * statement, driven at the cron.
 *
 * ── WHY AT THE CRON, AND WHY THE GUARD HAS ITS OWN TESTS ────────────────────
 *
 * `sendDueChases` ran three organisation-keyed reads and one write in the
 * cron's own context, which carries no organisation: it found no statements
 * and sent no chase, for anyone, while reporting a clean run. A probe as
 * graddly_app found it; no test did, because nothing entered at the cron.
 *
 * The already-chased guard is the dangerous half, and it fails in two
 * opposite directions:
 *
 *   - read with no organisation it matches nothing, so it stops guarding and
 *     every run chases the same signature again;
 *   - scoped to the wrong organisation it matches nothing it should, and the
 *     row it then writes suppresses that signature's chase for good.
 *
 * Neither shows up in a sweep that merely sends something. So the tests below
 * are: a second run sends nothing (the guard holds), another organisation's
 * dispatch row does not suppress this one (it is not over-scoped), and two
 * statements in different organisations each get their own chase in one run
 * (the per-organisation context is entered per statement, not once).
 *
 * The app connects as graddly_app with RLS enforced, asserted below.
 */
describe('Commitment chase cron (e2e)', () => {
  let app: INestApplication<App>;
  let sudo: Client;

  /** Two provider organisations, each with a statement 10 days unsigned. */
  type ChaseFixture = {
    orgId: string;
    signerUserId: string;
    statementId: string;
    signatureId: string;
  };

  const cron = () =>
    new CommitmentChaseCronService(
      app.get(ConfigService),
      new SchedulerRegistry(),
      new CronLockService(app.get(ConfigService), app.get(RedisService)),
      app.get(CommitmentChaseService),
    );

  const seedStatement = async (label: string): Promise<ChaseFixture> => {
    const suffix = `${Date.now()}-${label}`;
    const owner = await createVerifiedUser(app, {
      email: `chase-owner-${suffix}@example.com`,
    });
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...buildOrgPayload(`Chase Provider ${suffix}`),
        portalType: 'provider',
      })
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    // The statement graph is written with the superuser client: the real
    // flow needs a signed PDF and three parties, and none of that is the
    // property under test. The rows are exactly what the sweep reads.
    const apprentice = await sudo.query<{ id: string }>(
      `INSERT INTO apprentices ("organisationId", "firstName", "lastName", email)
       VALUES ($1, 'Chase', 'Apprentice', $2) RETURNING id`,
      [orgId, `chase-apprentice-${suffix}@example.com`],
    );
    const programme = await sudo.query<{ id: string }>(
      `INSERT INTO programmes ("organisationId", code, title)
       VALUES ($1, $2, 'Chase Programme') RETURNING id`,
      [orgId, `CHASE-PROG-${suffix}`],
    );
    const standard = await sudo.query<{ id: string }>(
      `INSERT INTO standards ("organisationId", "programmeId", code, title)
       VALUES ($1, $2, $3, 'Chase Standard') RETURNING id`,
      [orgId, programme.rows[0].id, `CHASE-STD-${suffix}`],
    );
    const enrolment = await sudo.query<{ id: string }>(
      `INSERT INTO enrolments ("organisationId", "apprenticeId", "standardId", status, "apprenticeUserId")
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [orgId, apprentice.rows[0].id, standard.rows[0].id, owner.userId],
    );
    const group = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_statement_groups ("organisationId", "enrolmentId", "apprenticeId")
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, enrolment.rows[0].id, apprentice.rows[0].id],
    );
    const statement = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_statements
         ("organisationId", "groupId", version, status, content,
          "apprenticeUserId", "tutorUserId", "employerManagerUserId", "createdAt")
       VALUES ($1, $2, 1, 'awaiting_signatures', '{}'::jsonb, $3, $3, $3,
               NOW() - INTERVAL '10 days')
       RETURNING id`,
      [orgId, group.rows[0].id, owner.userId],
    );
    const signature = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_signatures
         ("organisationId", "statementId", party, "signOrder", "signerUserId", status, "createdAt")
       VALUES ($1, $2, 'apprentice', 1, $3, 'pending', NOW() - INTERVAL '10 days')
       RETURNING id`,
      [orgId, statement.rows[0].id, owner.userId],
    );

    return {
      orgId,
      signerUserId: owner.userId,
      statementId: statement.rows[0].id,
      signatureId: signature.rows[0].id,
    };
  };

  const chaseRows = async (fixture: ChaseFixture): Promise<number> => {
    const r = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM commitment_chase_dispatches
        WHERE "signatureId" = $1 AND "organisationId" = $2 AND "isDeleted" = false`,
      [fixture.signatureId, fixture.orgId],
    );
    return Number(r.rows[0].n);
  };

  const chaseNotifications = async (fixture: ChaseFixture): Promise<number> => {
    const r = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications
        WHERE "userId" = $1 AND "organisationId" = $2 AND type = 'commitment'`,
      [fixture.signerUserId, fixture.orgId],
    );
    return Number(r.rows[0].n);
  };

  beforeAll(async () => {
    app = await createE2eApp();
    sudo = createE2ePgClient();
    await sudo.connect();
  });

  afterAll(async () => {
    await app?.close();
    await sudo?.end();
  });

  it('runs as graddly_app with RLS enforced', async () => {
    const [row] = await app
      .get(DataSource)
      .query<
        { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(row).toEqual({
      role: 'graddly_app',
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('chases each organisation own statement in one run, and does not chase twice', async () => {
    const first = await seedStatement('a');
    const second = await seedStatement('b');

    await cron().handleCommitmentChaseCron();

    // Each statement chased once, in its own organisation: the sweep enters
    // the context per statement rather than once for the run.
    expect(await chaseRows(first)).toBe(1);
    expect(await chaseRows(second)).toBe(1);
    expect(await chaseNotifications(first)).toBe(1);
    expect(await chaseNotifications(second)).toBe(1);

    // The guard holds on the next run: no second chase for either.
    await cron().handleCommitmentChaseCron();

    expect(await chaseRows(first)).toBe(1);
    expect(await chaseRows(second)).toBe(1);
    expect(await chaseNotifications(first)).toBe(1);
    expect(await chaseNotifications(second)).toBe(1);
  });

  /**
   * A chase already recorded in one organisation must not suppress another
   * organisation's, and must still suppress its own.
   *
   * The pair is deliberate. A guard that matched on the chase kind alone, or
   * one whose read returned whatever row it could see, would find the
   * already-chased organisation's row and skip the untouched one — which
   * looks identical to "nothing was due" and never recovers, because the
   * suppressing row stays there.
   *
   * (A dispatch row carrying one organisation's id and another's signature
   * is not representable: `UQ_commitment_chase_dispatches_signature_kind` is
   * unique on the signature, and a signature belongs to one organisation.
   * So the cross-tenant case is this one — two organisations, two
   * signatures, one already chased.)
   */
  it("does not let one organisation's recorded chase suppress another's", async () => {
    const alreadyChased = await seedStatement('c');
    const untouched = await seedStatement('d');

    await sudo.query(
      `INSERT INTO commitment_chase_dispatches
         ("organisationId", "signatureId", "chaseKind", "sentAt")
       VALUES ($1, $2, '7d', NOW())`,
      [alreadyChased.orgId, alreadyChased.signatureId],
    );

    await cron().handleCommitmentChaseCron();

    // The untouched organisation is chased.
    expect(await chaseRows(untouched)).toBe(1);
    expect(await chaseNotifications(untouched)).toBe(1);
    // The already-chased one is not chased again: still the seeded row, and
    // no notification, because the guard found its own organisation's row.
    expect(await chaseRows(alreadyChased)).toBe(1);
    expect(await chaseNotifications(alreadyChased)).toBe(0);
  });
});
