import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { ERASED } from '../../src/audit/audit-scrub.util.js';
import { PLATFORM_OPS_API_KEY_HEADER } from '../../src/platform-gdpr/platform-gdpr.constants.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  E2E_PLATFORM_OPS_API_KEY,
  applyPlatformOpsE2eEnv,
} from '../helpers/platform-ops-e2e-env.js';
import { createProviderDirectoryContext } from '../helpers/reporting-e2e.js';
import { createE2ePgClient } from '../helpers/rls-db.js';

import type { App } from 'supertest/types';

/**
 * Security hardening pass, item 5 — the erasure/retention reconciliation.
 *
 * Three entities gained free-text personal data after `ErasureService` was
 * written, and none of it was reachable by an Article 17 request:
 * `break_in_learning.reason` (often health data), the employer visit notes,
 * and the funding-claim resolution note.
 *
 * EVERY TEST HERE ASSERTS BOTH HALVES. Checking only that a column was
 * scrubbed would pass just as well if erasure had deleted the whole row, which
 * would destroy funding evidence the ESFA is entitled to. So each case also
 * asserts the evidential columns survived unchanged.
 *
 * Reads go through `createE2ePgClient()` (superuser) deliberately: these
 * assertions are about what is on disk after erasure, not about who can see
 * it, and RLS filtering would make an un-scrubbed row indistinguishable from
 * an invisible one.
 */
describe('GDPR erasure reconciliation (e2e)', () => {
  let app: INestApplication<App>;
  let sudo: Client;

  const opsAuthHeaders = (): Record<string, string> => ({
    [PLATFORM_OPS_API_KEY_HEADER]: E2E_PLATFORM_OPS_API_KEY,
  });

  beforeAll(async () => {
    applyPlatformOpsE2eEnv();
    app = await createE2eApp();
    sudo = createE2ePgClient();
    await sudo.connect();
  });

  afterAll(async () => {
    await sudo?.end();
    await app?.close();
  });

  const eraseApprentice = async (apprenticeId: string) =>
    request(app.getHttpServer())
      .post('/api/v1/platform/gdpr/erasure')
      .set(opsAuthHeaders())
      .send({
        subjectType: 'apprentice',
        subjectId: apprenticeId,
        reason: 'item 5 reconciliation e2e',
      })
      .expect(200);

  const apprenticeIdFor = async (enrolmentId: string): Promise<string> => {
    const res = await sudo.query<{ apprenticeId: string }>(
      `SELECT "apprenticeId" FROM enrolments WHERE id = $1`,
      [enrolmentId],
    );
    return res.rows[0].apprenticeId;
  };

  it('scrubs a break reason but keeps the dates that fund the record', async () => {
    const ctx = await createProviderDirectoryContext(app, 'gdpr-bil');
    const apprenticeId = await apprenticeIdFor(ctx.enrolmentId);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${ctx.enrolmentId}/break-in-learning`)
      .set(ctx.authHeaders)
      .send({
        reason: 'Long-term sickness absence',
        startedOn: '2026-03-01',
        expectedReturnDate: '2026-09-01',
      })
      .expect(201);

    await eraseApprentice(apprenticeId);

    const row = await sudo.query<{
      reason: string;
      startedOn: string;
      expectedReturnDate: string;
    }>(
      `SELECT reason, "startedOn"::text AS "startedOn",
              "expectedReturnDate"::text AS "expectedReturnDate"
         FROM break_in_learning WHERE "enrolmentId" = $1`,
      [ctx.enrolmentId],
    );

    // Special-category health data is gone.
    expect(row.rows[0].reason).toBe(ERASED);
    // The funding skeleton is not.
    expect(row.rows[0].startedOn).toBe('2026-03-01');
    expect(row.rows[0].expectedReturnDate).toBe('2026-09-01');
  });

  it('scrubs employer visit notes but keeps the visit as Ofsted evidence', async () => {
    const ctx = await createProviderDirectoryContext(app, 'gdpr-visit');
    const apprenticeId = await apprenticeIdFor(ctx.enrolmentId);

    await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(ctx.authHeaders)
      .send({
        employerOrganisationId: ctx.employerOrgId,
        visitedOn: '2026-05-06',
        visitType: 'on_site',
        attendees: 'Sarah Patel, Tom Reid',
        discussionPoints: 'Discussed the learner by name at length',
        actionPoints: 'Employer to release study time',
        enrolmentIds: [ctx.enrolmentId],
      })
      .expect(201);

    await eraseApprentice(apprenticeId);

    const row = await sudo.query<{
      attendees: string;
      discussionPoints: string;
      actionPoints: string;
      visitedOn: string;
      visitType: string;
    }>(
      `SELECT v.attendees, v."discussionPoints", v."actionPoints",
              v."visitedOn"::text AS "visitedOn", v."visitType"::text AS "visitType"
         FROM employer_visits v
         JOIN employer_visit_learners l ON l."visitId" = v.id
        WHERE l."enrolmentId" = $1`,
      [ctx.enrolmentId],
    );

    expect(row.rows[0].attendees).toBe(ERASED);
    expect(row.rows[0].discussionPoints).toBe(ERASED);
    expect(row.rows[0].actionPoints).toBe(ERASED);
    // The fact of the visit is the evidence; it survives.
    expect(row.rows[0].visitedOn).toBe('2026-05-06');
    expect(row.rows[0].visitType).toBe('on_site');
  });

  /**
   * A visit that never discussed this learner must keep its notes. Erasure is
   * scoped through `employer_visit_learners`, not by employer or by date —
   * scrubbing every visit to the same employer would destroy evidence about
   * other people who have not asked for anything.
   */
  it('leaves notes intact on a visit that did not discuss the erased learner', async () => {
    const ctx = await createProviderDirectoryContext(app, 'gdpr-visit-other');
    const apprenticeId = await apprenticeIdFor(ctx.enrolmentId);

    const unrelated = await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(ctx.authHeaders)
      .send({
        employerOrganisationId: ctx.employerOrgId,
        visitedOn: '2026-05-07',
        visitType: 'phone',
        attendees: 'Someone else entirely',
        discussionPoints: 'About a different apprentice',
      })
      .expect(201);

    const unrelatedId = (unrelated.body as { data: { id: string } }).data.id;

    await eraseApprentice(apprenticeId);

    const row = await sudo.query<{ attendees: string }>(
      `SELECT attendees FROM employer_visits WHERE id = $1`,
      [unrelatedId],
    );
    expect(row.rows[0].attendees).toBe('Someone else entirely');
  });

  it('scrubs a funding claim note but keeps the status and timestamps', async () => {
    const ctx = await createProviderDirectoryContext(app, 'gdpr-claim');
    const apprenticeId = await apprenticeIdFor(ctx.enrolmentId);

    await request(app.getHttpServer())
      .patch(`/api/v1/ilr/funding-claims/${ctx.enrolmentId}/resolution`)
      .set(ctx.authHeaders)
      .send({
        status: 'written_off',
        note: 'Named learner withdrew after a personal disclosure',
      })
      .expect(200);

    await eraseApprentice(apprenticeId);

    const row = await sudo.query<{
      note: string;
      status: string;
      closedAt: string | null;
    }>(
      `SELECT note, status::text AS status, "closedAt"::text AS "closedAt"
         FROM funding_claim_resolutions WHERE "enrolmentId" = $1`,
      [ctx.enrolmentId],
    );

    expect(row.rows[0].note).toBe(ERASED);
    // The financial decision itself is evidential and stays.
    expect(row.rows[0].status).toBe('written_off');
    expect(row.rows[0].closedAt).not.toBeNull();
  });
});
