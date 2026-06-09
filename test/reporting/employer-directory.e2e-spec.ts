import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectPaginatedListEnvelope } from '../helpers/e2e-response-contracts.js';
import { expectEmployerDirectoryEntryResource } from '../helpers/reporting-contracts.js';
import {
  createEmployerReportingContext,
  createProviderDirectoryContext,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('EmployerDirectoryController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /reporting/employer-directory returns paginated linked employers', async () => {
    const ctx = await createProviderDirectoryContext(app, 'list');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-directory')
      .set(ctx.authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(res.body);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expectEmployerDirectoryEntryResource(res.body.data[0]);
    expect(res.body.data[0].employerOrganisationId).toBe(ctx.employerOrgId);
  });

  it('supports region and learner count filters', async () => {
    const ctx = await createProviderDirectoryContext(app, 'filters');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-directory')
      .query({ region: 'London', minActiveLearners: 1 })
      .set(ctx.authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(res.body);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 403 when active org is an employer portal', async () => {
    const ctx = await createEmployerReportingContext(app, 'forbidden-dir');

    await request(app.getHttpServer())
      .get('/api/v1/reporting/employer-directory')
      .set(ctx.authHeaders)
      .expect(403);
  });
});
