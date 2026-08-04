import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { FundingClaimDiscrepancy } from '../src/ilr/enums/funding-claim-discrepancy.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/**
 * F2.3.2 AC7 — the funding claim tracker.
 */
describe('Funding claims (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface IClaim {
    enrolmentId: string;
    claimedAmount: number;
    receivedAmount: number;
    varianceAmount: number;
    discrepancy: string;
    resolutionStatus: string | null;
    resolutionNote: string | null;
  }

  const listClaims = async (
    ctx: Awaited<ReturnType<typeof createProviderDirectoryContext>>,
    query = '',
  ): Promise<IClaim[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/ilr/funding-claims${query}`)
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    return (res.body as { data: IClaim[] }).data;
  };

  /**
   * The judgement the feature rests on: funding arrives monthly, so an active
   * learner with no payments yet is not a discrepancy. If this ever regresses,
   * every in-flight learner is flagged and the tracker becomes noise.
   */
  it('does not flag an active enrolment awaiting its funding', async () => {
    const ctx = await createProviderDirectoryContext(app, 'fc-active');

    const claims = await listClaims(ctx);
    const claim = claims.find((c) => c.enrolmentId === ctx.enrolmentId);

    expect(claim).toBeDefined();
    expect(claim!.claimedAmount).toBe(15000);
    expect(claim!.receivedAmount).toBe(0);
    expect(claim!.discrepancy).toBe(FundingClaimDiscrepancy.NONE);
    // Nothing to resolve, so no status is asserted.
    expect(claim!.resolutionStatus).toBeNull();
  });

  it('excludes reconciled claims when filtering to discrepancies', async () => {
    const ctx = await createProviderDirectoryContext(app, 'fc-filter');

    const claims = await listClaims(ctx, '?discrepanciesOnly=true');

    expect(
      claims.find((c) => c.enrolmentId === ctx.enrolmentId),
    ).toBeUndefined();
  });

  it('records a resolution and reads it back', async () => {
    const ctx = await createProviderDirectoryContext(app, 'fc-resolve');

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/ilr/funding-claims/${ctx.enrolmentId}/resolution`)
      .set(ctx.authHeaders)
      .send({ status: 'investigating' })
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect((res.body as { data: IClaim }).data.resolutionStatus).toBe(
      'investigating',
    );

    const claims = await listClaims(ctx);
    const claim = claims.find((c) => c.enrolmentId === ctx.enrolmentId);
    expect(claim!.resolutionStatus).toBe('investigating');
  });

  /**
   * An ESFA reconciliation asks why a gap was closed. "Someone clicked
   * resolved" is not an answer, so the API refuses to record one.
   */
  it('refuses to close a claim without a note', async () => {
    const ctx = await createProviderDirectoryContext(app, 'fc-note');

    await request(app.getHttpServer())
      .patch(`/api/v1/ilr/funding-claims/${ctx.enrolmentId}/resolution`)
      .set(ctx.authHeaders)
      .send({ status: 'resolved' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/ilr/funding-claims/${ctx.enrolmentId}/resolution`)
      .set(ctx.authHeaders)
      .send({
        status: 'written_off',
        note: 'ESFA confirmed no further payment',
      })
      .expect(200);
  });

  it('does not leak claims across organisations', async () => {
    const mine = await createProviderDirectoryContext(app, 'fc-mine');
    const theirs = await createProviderDirectoryContext(app, 'fc-theirs');

    const claims = await listClaims(mine);

    expect(
      claims.find((c) => c.enrolmentId === theirs.enrolmentId),
    ).toBeUndefined();
  });
});
