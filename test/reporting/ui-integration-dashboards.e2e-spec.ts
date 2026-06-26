import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  ORGANISATION_ID_HEADER,
  PORTAL_TYPE_HEADER,
} from '../../src/common/constants/organisation-headers.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  createEmployerReportingContext,
  createProviderDirectoryContext,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('Learner me summary (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns empty summary for provider org user without apprentice enrolment', async () => {
    const ctx = await createProviderDirectoryContext(
      app,
      'me-summary-provider',
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/me/summary')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const summary = (res.body as { data: { activeEnrolmentId: string | null } })
      .data;
    expect(summary.activeEnrolmentId).toBeNull();
  });

  it('returns summary shape for employer org (wrong portal)', async () => {
    const ctx = await createEmployerReportingContext(
      app,
      'me-summary-employer',
    );

    await request(app.getHttpServer())
      .get('/api/v1/learners/me/summary')
      .set(ctx.authHeaders)
      .expect(403);
  });
});

describe('Reporting dashboards (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /reporting/employer-dashboard returns summary for employer org', async () => {
    const ctx = await createProviderDirectoryContext(app, 'employer-dash');
    const employerHeaders = {
      ...ctx.authHeaders,
      [ORGANISATION_ID_HEADER]: ctx.employerOrgId,
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-dashboard')
      .set(employerHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const summary = (
      res.body as { data: { summary: { activeApprenticeCount: number } } }
    ).data.summary;
    expect(summary.activeApprenticeCount).toBeGreaterThanOrEqual(1);
  });

  it('GET /reporting/employer-dashboard returns 403 for provider org', async () => {
    const ctx = await createProviderDirectoryContext(
      app,
      'employer-dash-forbidden',
    );

    await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-dashboard')
      .set(ctx.authHeaders)
      .expect(403);
  });

  it('GET /reporting/provider-dashboard returns summary for provider org', async () => {
    const ctx = await createProviderDirectoryContext(app, 'provider-dash');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/provider-dashboard')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const summary = (res.body as { data: { summary: { cohortCount: number } } })
      .data.summary;
    expect(summary.cohortCount).toBeGreaterThanOrEqual(1);
  });
});

describe('Portal-scoped enrolments list (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists enrolments for employer by employerOrganisationId', async () => {
    const ctx = await createProviderDirectoryContext(
      app,
      'enrol-employer-list',
    );
    const employerHeaders = {
      ...ctx.authHeaders,
      [ORGANISATION_ID_HEADER]: ctx.employerOrgId,
      [PORTAL_TYPE_HEADER]: 'employer',
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/enrolments')
      .set(employerHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const rows = (res.body as { data: { id: string }[] }).data;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((row) => row.id === ctx.enrolmentId)).toBe(true);
  });

  it('lists enrolments for provider unchanged', async () => {
    const ctx = await createProviderDirectoryContext(
      app,
      'enrol-provider-list',
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/enrolments')
      .set({
        ...ctx.authHeaders,
        [PORTAL_TYPE_HEADER]: 'provider',
      })
      .expect(200);

    expectSuccessEnvelope(res.body);
    const rows = (res.body as { data: { id: string }[] }).data;
    expect(rows.some((row) => row.id === ctx.enrolmentId)).toBe(true);
  });
});
