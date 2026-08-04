import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/**
 * F2.4.2 — the employer visit log, and F2.4.1's `lastVisitDate` which it fills.
 */
describe('Employer visits (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const basePayload = (employerOrganisationId: string) => ({
    employerOrganisationId,
    visitedOn: '2026-08-03',
    visitType: 'on_site',
    attendees: 'Sarah Patel (Operations Manager), Tom Reid (tutor)',
    discussionPoints: 'Reviewed progress and off-the-job hours.',
    actionPoints: 'Employer to release two hours a week for study.',
  });

  it('records a visit with the learners discussed', async () => {
    const ctx = await createProviderDirectoryContext(app, 'ev-create');

    const res = await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(ctx.authHeaders)
      .send({
        ...basePayload(ctx.employerOrgId),
        enrolmentIds: [ctx.enrolmentId],
      })
      .expect(201);

    expectSuccessEnvelope(res.body);
    const visit = (
      res.body as {
        data: {
          id: string;
          visitedOn: string;
          employerName: string | null;
          learners: { enrolmentId: string; apprenticeName: string }[];
        };
      }
    ).data;

    expect(visit.visitedOn).toBe('2026-08-03');
    expect(visit.employerName).toBeTruthy();
    expect(visit.learners).toHaveLength(1);
    expect(visit.learners[0].enrolmentId).toBe(ctx.enrolmentId);
    expect(visit.learners[0].apprenticeName).toBeTruthy();
  });

  /**
   * AC2. A visit to employer A must not be able to cite a learner placed with
   * employer B — that learner would then carry evidence of a meeting that
   * never discussed them.
   */
  it('refuses a learner who is not enrolled with the visited employer', async () => {
    const mine = await createProviderDirectoryContext(app, 'ev-wrong-a');
    const other = await createProviderDirectoryContext(app, 'ev-wrong-b');

    await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(mine.authHeaders)
      .send({
        ...basePayload(mine.employerOrgId),
        // Belongs to a different provider and a different employer.
        enrolmentIds: [other.enrolmentId],
      })
      .expect(400);
  });

  it('lists visits for one employer, newest first', async () => {
    const ctx = await createProviderDirectoryContext(app, 'ev-list');

    for (const visitedOn of ['2026-01-10', '2026-06-20']) {
      await request(app.getHttpServer())
        .post('/api/v1/employer-visits')
        .set(ctx.authHeaders)
        .send({ ...basePayload(ctx.employerOrgId), visitedOn })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/employer-visits?employerOrganisationId=${ctx.employerOrgId}`,
      )
      .set(ctx.authHeaders)
      .expect(200);

    const visits = (res.body as { data: { visitedOn: string }[] }).data;
    expect(visits).toHaveLength(2);
    expect(visits[0].visitedOn).toBe('2026-06-20');
  });

  /**
   * AC4. Counted from the last visit rather than today, so a visit recorded
   * late does not push the whole schedule back by the delay.
   */
  it('suggests the next visit twelve weeks after the last one', async () => {
    const ctx = await createProviderDirectoryContext(app, 'ev-suggest');

    const before = await request(app.getHttpServer())
      .get(
        `/api/v1/employer-visits/next-visit-suggestion?employerOrganisationId=${ctx.employerOrgId}`,
      )
      .set(ctx.authHeaders)
      .expect(200);

    expect(
      (before.body as { data: { lastVisitedOn: string | null } }).data
        .lastVisitedOn,
    ).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(ctx.authHeaders)
      .send({ ...basePayload(ctx.employerOrgId), visitedOn: '2026-01-01' })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(
        `/api/v1/employer-visits/next-visit-suggestion?employerOrganisationId=${ctx.employerOrgId}`,
      )
      .set(ctx.authHeaders)
      .expect(200);

    const suggestion = (
      after.body as {
        data: {
          lastVisitedOn: string;
          suggestedDate: string;
          intervalWeeks: number;
        };
      }
    ).data;

    expect(suggestion.lastVisitedOn).toBe('2026-01-01');
    expect(suggestion.suggestedDate).toBe('2026-03-26');
    expect(suggestion.intervalWeeks).toBe(12);
  });

  /**
   * F2.4.1. `lastVisitDate` shipped as a hardcoded `null` labelled "reserved
   * for the employer visit log". This is the test that it is no longer.
   */
  it('surfaces the visit date on the employer directory', async () => {
    const ctx = await createProviderDirectoryContext(app, 'ev-directory');

    const before = await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-directory')
      .set(ctx.authHeaders)
      .expect(200);

    const beforeRow = (
      before.body as {
        data: {
          employerOrganisationId: string;
          lastVisitDate: string | null;
        }[];
      }
    ).data.find((r) => r.employerOrganisationId === ctx.employerOrgId);
    expect(beforeRow?.lastVisitDate).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(ctx.authHeaders)
      .send({ ...basePayload(ctx.employerOrgId), visitedOn: '2026-07-15' })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-directory')
      .set(ctx.authHeaders)
      .expect(200);

    const afterRow = (
      after.body as {
        data: {
          employerOrganisationId: string;
          lastVisitDate: string | null;
        }[];
      }
    ).data.find((r) => r.employerOrganisationId === ctx.employerOrgId);
    expect(afterRow?.lastVisitDate).toBe('2026-07-15');
  });

  it('does not leak visits across providers', async () => {
    const mine = await createProviderDirectoryContext(app, 'ev-mine');
    const theirs = await createProviderDirectoryContext(app, 'ev-theirs');

    await request(app.getHttpServer())
      .post('/api/v1/employer-visits')
      .set(theirs.authHeaders)
      .send({
        ...basePayload(theirs.employerOrgId),
        discussionPoints: 'their-private-note',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/v1/employer-visits')
      .set(mine.authHeaders)
      .expect(200);

    expect((res.body as { data: unknown[] }).data).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain('their-private-note');
  });
});
