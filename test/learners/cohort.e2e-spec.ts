import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectPaginatedListEnvelope } from '../helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('Learner cohort (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns cohort rows for provider organisation', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort');

    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/cohort')
      .set(ctx.authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(res.body);
    const rows = (res.body as { data: { learnerName: string }[] }).data;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.learnerName).toContain('Report');
  });

  it('exports cohort as CSV', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort-csv');

    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/cohort')
      .query({ format: 'csv' })
      .set(ctx.authHeaders)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('enrolmentId');
    expect(res.text).toContain('learnerName');
  });

  it('returns 403 for non-provider active organisation', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort-forbidden');
    const employerHeaders = {
      ...ctx.authHeaders,
      [ORGANISATION_ID_HEADER]: ctx.employerOrgId,
    };

    await request(app.getHttpServer())
      .get('/api/v1/learners/cohort')
      .set(employerHeaders)
      .expect(403);
  });
});
