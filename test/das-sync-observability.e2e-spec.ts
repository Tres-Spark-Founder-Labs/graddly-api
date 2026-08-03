import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { DasApiActivityService } from '../src/das/das-api-activity.service.js';
import { DasApiOperation } from '../src/das/enums/das-api-operation.enum.js';
import { DasSyncHealth } from '../src/das/enums/das-sync-health.enum.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

/**
 * F2.3.1 AC5 and AC7 — sync health, and the API activity log behind it.
 */
describe('DAS sync observability (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const createProviderContext = async (label: string) => {
    const suffix = `${label}-${Date.now()}`;
    const owner = await createVerifiedUser(app, {
      email: `das-obs-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...buildOrgPayload(`DAS Obs ${suffix}`),
        portalType: 'provider',
      })
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    // Assigned rather than declared inline: the naming-convention rule rejects
    // a PascalCase object key, and this is the shape the other e2e helpers use.
    const headers: Record<string, string> = {
      [ORGANISATION_ID_HEADER]: organisationId,
    };
    headers['Authorization'] = `Bearer ${owner.accessToken}`;

    return { organisationId, userId: owner.userId, headers };
  };

  /**
   * Writing through the service directly, as the HTTP client does.
   *
   * The tenant GUCs must be set first: `das_api_activity` is RLS-partitioned,
   * so an insert with no `app.current_org` is rejected by the INSERT policy —
   * and `record()` swallows that failure by design, so the row simply never
   * appears rather than the test erroring. Which is itself proof that
   * recording can never fail a DAS call.
   */
  const recordActivity = async (
    organisationId: string,
    userId: string,
    over: Partial<Parameters<DasApiActivityService['record']>[0]> = {},
  ) => {
    setCurrentOrganisationId(organisationId);
    setCurrentUserId(userId);
    setLastKnownUserIdForGuc(userId);

    const service = app.get(DasApiActivityService);
    await service.record({
      organisationId,
      operation: DasApiOperation.LEVY_BALANCE,
      method: 'GET',
      url: 'https://das.example.com/api/levy?ukprn=10001234',
      responseStatus: 200,
      succeeded: true,
      durationMs: 42,
      ...over,
    });
  };

  /**
   * AC5. Zero errors reads as healthy to the obvious implementation, but a
   * provider whose integration has never once worked is in the worst state
   * this indicator describes.
   */
  it('reports red before anything has ever synced', async () => {
    const ctx = await createProviderContext('never');

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/sync-status')
      .set(ctx.headers)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const status = (
      res.body as {
        data: { health: string; lastSyncAt: string | null; errorCount: number };
      }
    ).data;

    expect(status.health).toBe(DasSyncHealth.RED);
    expect(status.lastSyncAt).toBeNull();
    expect(status.errorCount).toBe(0);
  });

  it('turns green once a sync operation succeeds', async () => {
    const ctx = await createProviderContext('green');
    await recordActivity(ctx.organisationId, ctx.userId);

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/sync-status')
      .set(ctx.headers)
      .expect(200);

    const status = (
      res.body as { data: { health: string; lastSyncAt: string | null } }
    ).data;

    expect(status.health).toBe(DasSyncHealth.GREEN);
    expect(status.lastSyncAt).not.toBeNull();
  });

  it('turns red when the most recent attempt failed', async () => {
    const ctx = await createProviderContext('red');
    await recordActivity(ctx.organisationId, ctx.userId);
    await recordActivity(ctx.organisationId, ctx.userId, {
      responseStatus: 503,
      succeeded: false,
      errorMessage: 'ESFA unavailable',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/sync-status')
      .set(ctx.headers)
      .expect(200);

    const status = (
      res.body as {
        data: { health: string; errorCount: number; lastErrorMessage: string };
      }
    ).data;

    expect(status.health).toBe(DasSyncHealth.RED);
    expect(status.errorCount).toBe(1);
    expect(status.lastErrorMessage).toBe('ESFA unavailable');
  });

  // AC7 — the log itself.
  it('lists recorded calls newest first and filters to failures', async () => {
    const ctx = await createProviderContext('log');
    await recordActivity(ctx.organisationId, ctx.userId);
    await recordActivity(ctx.organisationId, ctx.userId, {
      operation: DasApiOperation.ENROLMENT_SUBMIT,
      method: 'POST',
      responseStatus: 400,
      succeeded: false,
      errorMessage: 'ULN already registered',
    });

    const all = await request(app.getHttpServer())
      .get('/api/v1/das/activity')
      .set(ctx.headers)
      .expect(200);

    expectSuccessEnvelope(all.body);
    const entries = (all.body as { data: { succeeded: boolean }[] }).data;
    expect(entries.length).toBe(2);

    const failures = await request(app.getHttpServer())
      .get('/api/v1/das/activity?failedOnly=true')
      .set(ctx.headers)
      .expect(200);

    const failed = (
      failures.body as {
        data: { succeeded: boolean; operation: string; errorMessage: string }[];
      }
    ).data;

    expect(failed).toHaveLength(1);
    expect(failed[0].succeeded).toBe(false);
    expect(failed[0].operation).toBe(DasApiOperation.ENROLMENT_SUBMIT);
    expect(failed[0].errorMessage).toBe('ULN already registered');
  });

  /**
   * A timeout has no status code. "We never reached the ESFA" must stay
   * distinguishable from "the ESFA answered and refused" — it is the first
   * question asked about a failed submission.
   */
  it('preserves a null status for calls that never got a reply', async () => {
    const ctx = await createProviderContext('timeout');
    await recordActivity(ctx.organisationId, ctx.userId, {
      responseStatus: null,
      succeeded: false,
      errorMessage: 'The operation was aborted due to timeout',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/activity')
      .set(ctx.headers)
      .expect(200);

    const entries = (res.body as { data: { responseStatus: number | null }[] })
      .data;
    expect(entries[0].responseStatus).toBeNull();
  });

  /**
   * The property that makes this table safe to keep. It is long-lived, widely
   * readable and exported; a bearer token reaching it would make the platform
   * less secure than having no log at all.
   */
  it('never stores credentials, in the URL or the request summary', async () => {
    const ctx = await createProviderContext('scrub');
    await recordActivity(ctx.organisationId, ctx.userId, {
      url: 'https://das.example.com/api/levy?ukprn=10001234&access_token=super-secret',
      requestSummary: {
        ukprn: '10001234',
        authorization: 'Bearer super-secret',
        nested: { clientSecret: 'super-secret' },
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/activity')
      .set(ctx.headers)
      .expect(200);

    const entry = (
      res.body as {
        data: { url: string; requestSummary: Record<string, unknown> }[];
      }
    ).data[0];

    expect(JSON.stringify(entry)).not.toContain('super-secret');
    expect(entry.url).toContain('ukprn=10001234');
    expect(entry.requestSummary.ukprn).toBe('10001234');
  });

  /**
   * The activity log is partitioned by RLS. One provider must never see
   * another's ESFA traffic.
   */
  it('does not leak activity across organisations', async () => {
    const mine = await createProviderContext('mine');
    const theirs = await createProviderContext('theirs');

    await recordActivity(theirs.organisationId, theirs.userId, {
      errorMessage: 'their-private-error',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/das/activity')
      .set(mine.headers)
      .expect(200);

    const entries = (res.body as { data: unknown[] }).data;
    expect(entries).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toContain('their-private-error');
  });
});
