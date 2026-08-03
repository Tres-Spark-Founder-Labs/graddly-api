import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/**
 * F2.2.4 AC7 — "profile loads within 2 seconds".
 *
 * Measured server-side, against a database on the same machine, so this is a
 * floor rather than a promise about production. It exists to catch the thing
 * that actually breaks the budget: someone adding an N+1 to the profile
 * without noticing. A margin is left because CI machines are noisy — a
 * regression that matters will blow past 2000ms, not creep to 1900ms.
 */
const PROFILE_BUDGET_MS = 2_000;

interface IProfileResponse {
  enrolmentId: string;
  personal: { email: string };
  programme: {
    standardTitle: string;
    epaOrganisationName: string | null;
    epaOrganisationUkprn: string | null;
  };
  employer: { organisationName: string | null };
  otj: {
    totalCount: number;
    truncated: boolean;
    recentEntries: {
      id: string;
      activityName: string;
      flaggedAt: string | null;
      flagNote: string | null;
    }[];
  };
  messageThreads: {
    id: string;
    counterpartyParty: string;
    counterpartyName: string | null;
    messageCount: number;
    unreadCount: number;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
  }[];
  breakInLearning: {
    active: boolean;
    reason: string | null;
    expectedReturnDate: string | null;
  };
}

describe('Learner profile (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const getProfile = async (
    ctx: Awaited<ReturnType<typeof createProviderDirectoryContext>>,
  ): Promise<IProfileResponse> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/learners/${ctx.enrolmentId}/profile`)
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    return (res.body as { data: IProfileResponse }).data;
  };

  it('returns aggregated learner profile for provider', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile');
    const profile = await getProfile(ctx);

    expect(profile.enrolmentId).toBe(ctx.enrolmentId);
    expect(profile.personal.email).toContain('@example.com');
    expect(profile.programme.standardTitle).toBeTruthy();
    expect(profile.employer.organisationName).toBeTruthy();
    expect(Array.isArray(profile.messageThreads)).toBe(true);
  });

  // F2.2.4 AC1 — a tutor chasing an overdue result needs to know who to ring,
  // not only when the assessment was booked.
  it('surfaces the EPA organisation once one is appointed', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile-epao');

    const before = await getProfile(ctx);
    expect(before.programme.epaOrganisationName).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${ctx.enrolmentId}/journey`)
      .set(ctx.authHeaders)
      .send({
        epaOrganisationName: 'BCS, The Chartered Institute for IT',
        epaOrganisationUkprn: '10001234',
      })
      .expect(200);

    const after = await getProfile(ctx);
    expect(after.programme.epaOrganisationName).toBe(
      'BCS, The Chartered Institute for IT',
    );
    expect(after.programme.epaOrganisationUkprn).toBe('10001234');
  });

  // F2.2.4 AC3 — the log is a count plus a list, and the list says when it is
  // not the whole log.
  it('reports the OTJ log honestly, including tutor flags', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile-otj');
    const profile = await getProfile(ctx);

    expect(profile.otj.totalCount).toBe(profile.otj.recentEntries.length);
    expect(profile.otj.truncated).toBe(false);
    for (const entry of profile.otj.recentEntries) {
      expect(entry).toHaveProperty('activityName');
      expect(entry).toHaveProperty('flaggedAt');
      expect(entry).toHaveProperty('flagNote');
    }
  });

  // F2.2.4 AC5 — this was an array of UUIDs, which no screen could render.
  it('returns renderable thread summaries rather than bare ids', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile-threads');

    // Threads are provisioned on demand by the messaging list endpoint.
    await request(app.getHttpServer())
      .get(`/api/v1/messaging/threads?enrolmentId=${ctx.enrolmentId}`)
      .set(ctx.authHeaders)
      .expect(200);

    const profile = await getProfile(ctx);
    for (const thread of profile.messageThreads) {
      expect(typeof thread.id).toBe('string');
      expect(typeof thread.counterpartyParty).toBe('string');
      expect(typeof thread.messageCount).toBe('number');
      expect(typeof thread.unreadCount).toBe('number');
      expect(thread).toHaveProperty('lastMessagePreview');
    }
  });

  // F2.2.4 AC6 — `reason` and `expectedReturnDate` were hardcoded `null` on
  // this endpoint. A paused learner showed as paused for no stated reason.
  it('reflects a recorded break in learning', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile-bil');

    const before = await getProfile(ctx);
    expect(before.breakInLearning.active).toBe(false);
    expect(before.breakInLearning.reason).toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${ctx.enrolmentId}/break-in-learning`)
      .set(ctx.authHeaders)
      .send({
        reason: 'Maternity leave',
        startedOn: '2026-07-01',
        expectedReturnDate: '2026-11-01',
      })
      .expect(201);

    const during = await getProfile(ctx);
    expect(during.breakInLearning.active).toBe(true);
    expect(during.breakInLearning.reason).toBe('Maternity leave');
    expect(during.breakInLearning.expectedReturnDate).toBe('2026-11-01');

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${ctx.enrolmentId}/break-in-learning/end`)
      .set(ctx.authHeaders)
      .send({ actualReturnDate: '2026-10-15' })
      .expect(201);

    const after = await getProfile(ctx);
    expect(after.breakInLearning.active).toBe(false);
    expect(after.breakInLearning.reason).toBeNull();
  });

  it(`loads within the ${PROFILE_BUDGET_MS}ms budget`, async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile-budget');

    // Warm the connection pool and any first-hit caches so the measurement is
    // of the endpoint rather than of process start-up.
    await getProfile(ctx);

    const startedAt = Date.now();
    await getProfile(ctx);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(PROFILE_BUDGET_MS);
  });
});
