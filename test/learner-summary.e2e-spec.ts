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
 * P0-A — `GET /learners/me/summary`, the endpoint four features are about to
 * consume.
 *
 * The unit cover for the arithmetic itself is in
 * `src/otj/otj-summary.service.spec.ts`. What can only be proven end to end is
 * that the figures are **scoped**: a summary that aggregated across learners or
 * across tenants would be a worse defect than the one P0-B just fixed, because
 * the number would look plausible rather than obviously wrong.
 *
 * The fixture seeds each learner with one approved entry (120 min) and one
 * submitted entry (90 min), so every assertion below has a specific expected
 * value rather than a "greater than zero" that would pass on a leak.
 */
describe('Learner summary (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: ILearnerScopeContext;

  beforeAll(async () => {
    app = await createE2eApp();
    ctx = await createLearnerScopeContext(app, 'summary');
  }, 180_000);

  afterAll(async () => {
    await ctx?.sudo?.end();
    await app?.close();
  });

  type PaceBody = {
    data: {
      activeEnrolmentId: string | null;
      otjPace: {
        alertLevel: string | null;
        otjPercent: number | null;
        approvedMinutes: number;
        loggedMinutes: number;
        pendingMinutes: number;
        rejectedMinutes: number;
      };
    };
  };

  const summaryFor = async (headers: Record<string, string>) => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/me/summary')
      .set(headers)
      .expect(200);
    return (res.body as PaceBody).data;
  };

  describe('the three fields are live and correct', () => {
    it('reports the learner own approved, pending and logged minutes', async () => {
      const data = await summaryFor(ctx.learnerA.headers);

      expect(data.activeEnrolmentId).toBe(ctx.learnerA.enrolmentId);
      expect(data.otjPace.approvedMinutes).toBe(120);
      expect(data.otjPace.pendingMinutes).toBe(90);
      expect(data.otjPace.loggedMinutes).toBe(210);
      expect(data.otjPace.rejectedMinutes).toBe(0);
    });

    /**
     * D2 made explicit as an assertion rather than left to the label: the
     * authoritative figure excludes hours the provider has not approved.
     */
    it('keeps approved and pending separate, and publishes no merged total', async () => {
      const data = await summaryFor(ctx.learnerA.headers);

      expect(data.otjPace.approvedMinutes).not.toBe(data.otjPace.loggedMinutes);
      expect(data.otjPace).not.toHaveProperty('totalMinutes');
      expect(data.otjPace).not.toHaveProperty('combinedMinutes');
    });

    /**
     * Draft minutes are not a field; they are the remainder. Asserted so the
     * documented reconciliation is a property of the API and not just prose in
     * the DTO.
     */
    it('leaves draft minutes derivable from the four figures', async () => {
      const { otjPace } = await summaryFor(ctx.learnerA.headers);

      const draft =
        otjPace.loggedMinutes -
        otjPace.pendingMinutes -
        otjPace.approvedMinutes -
        otjPace.rejectedMinutes;

      expect(draft).toBe(0);
    });
  });

  /**
   * The learner-scope gate P0-A's brief requires. Both learners sit in the same
   * organisation with identical minute totals, so a summary that aggregated
   * across them would return 240/180/420 rather than 120/90/210 — a wrong
   * number that still looks like a real one.
   */
  describe('cannot aggregate across learners', () => {
    it('gives each learner only their own minutes', async () => {
      const a = await summaryFor(ctx.learnerA.headers);
      const b = await summaryFor(ctx.learnerB.headers);

      expect(a.activeEnrolmentId).toBe(ctx.learnerA.enrolmentId);
      expect(b.activeEnrolmentId).toBe(ctx.learnerB.enrolmentId);
      expect(a.activeEnrolmentId).not.toBe(b.activeEnrolmentId);

      for (const data of [a, b]) {
        expect(data.otjPace.approvedMinutes).toBe(120);
        expect(data.otjPace.pendingMinutes).toBe(90);
        expect(data.otjPace.loggedMinutes).toBe(210);
      }
    });

    it('does not move one learner figures when another logs hours', async () => {
      const before = await summaryFor(ctx.learnerA.headers);

      await ctx.sudo.query(
        `INSERT INTO otj_log_entries
           ("organisationId", "enrolmentId", "apprenticeId", "loggedDate",
            minutes, "activityName", category, status, "approvedAt")
         VALUES ($1, $2, $3, CURRENT_DATE, 600, 'B-EXTRA', 'other', 'approved', NOW())`,
        [
          ctx.providerOrgId,
          ctx.learnerB.enrolmentId,
          ctx.learnerB.apprenticeId,
        ],
      );

      const after = await summaryFor(ctx.learnerA.headers);
      expect(after.otjPace.approvedMinutes).toBe(
        before.otjPace.approvedMinutes,
      );

      // ...and the learner it belongs to does see it.
      const bAfter = await summaryFor(ctx.learnerB.headers);
      expect(bAfter.otjPace.approvedMinutes).toBe(720);
    });
  });

  describe('cannot aggregate across tenants', () => {
    it('returns an empty summary to a learner-less principal in another org', async () => {
      const stranger = await createProviderDirectoryContext(app, 'summary-x');

      const res = await request(app.getHttpServer())
        .get('/api/v1/learners/me/summary')
        .set({
          [AUTH_HEADER]: `Bearer ${stranger.owner.accessToken}`,
          [ORGANISATION_ID_HEADER]: stranger.providerOrgId,
        })
        .expect(200);

      const data = (res.body as PaceBody).data;

      // No enrolment names this user, so there is nothing to summarise — and
      // crucially none of the other organisation's minutes leak in.
      expect(data.activeEnrolmentId).toBeNull();
      expect(data.otjPace.approvedMinutes).toBe(0);
      expect(data.otjPace.loggedMinutes).toBe(0);
      expect(data.otjPace.pendingMinutes).toBe(0);
    });

    it('does not answer for a learner outside their own organisation', async () => {
      const stranger = await createProviderDirectoryContext(app, 'summary-y');

      // Learner A's token, pointed at an organisation they do not belong to.
      const res = await request(app.getHttpServer())
        .get('/api/v1/learners/me/summary')
        .set({
          [AUTH_HEADER]: `Bearer ${ctx.learnerA.accessToken}`,
          [ORGANISATION_ID_HEADER]: stranger.providerOrgId,
        });

      expect([403, 404]).toContain(res.status);
    });
  });
});
