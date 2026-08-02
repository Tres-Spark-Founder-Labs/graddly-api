import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { PdfJobStatus } from '../../src/pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../../src/pdf/enums/pdf-job-template.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import { processPdfJobInApp } from '../helpers/process-pdf-job.js';
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

  /**
   * F2.2.1 AC5.
   *
   * This test existed and passed while the route was returning
   * `{"message":"Success","data":"enrolmentId,learnerName,…"}` — because
   * `toContain('enrolmentId')` is satisfied just as well by a CSV string
   * sitting inside a JSON envelope. The assertions below check the shape of
   * the body, not merely that the right words appear somewhere in it.
   */
  it('exports cohort as raw CSV, not a JSON envelope', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort-csv');

    const res = await request(app.getHttpServer())
      .get('/api/v1/learners/cohort')
      .query({ format: 'csv' })
      .set(ctx.authHeaders)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text.startsWith('{')).toBe(false);
    // The header row must be the first line of the file.
    expect(res.text.split('\n')[0]).toContain('enrolmentId');
    expect(res.text.split('\n')[0]).toContain('learnerName');
  });

  /** F2.2.1 AC5 — the PDF half, which did not exist. */
  it('queues and completes a cohort PDF export', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort-pdf');

    const queueRes = await request(app.getHttpServer())
      .post('/api/v1/learners/cohort/export')
      .set(ctx.authHeaders)
      .send({})
      .expect(201);

    expectSuccessEnvelope(queueRes.body);
    const jobId = (queueRes.body as { data: { jobId: string } }).data.jobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId: ctx.providerOrgId,
      userId: ctx.owner.userId,
      template: PdfJobTemplate.LEARNER_COHORT,
    });

    const statusRes = await request(app.getHttpServer())
      .get(`/api/v1/pdf/jobs/${jobId}`)
      .set(ctx.authHeaders)
      .expect(200);

    const job = (
      statusRes.body as { data: { status: string; outputKey: string } }
    ).data;
    expect(job.status).toBe(PdfJobStatus.COMPLETED);
    expect(job.outputKey).toContain('/export/');
  });

  /** The filters must reach the worker, or the PDF is of the wrong cohort. */
  it('carries the cohort filters through to the queued PDF job', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cohort-pdf-filter');

    const queueRes = await request(app.getHttpServer())
      .post('/api/v1/learners/cohort/export')
      .query({ statusBadge: 'withdrawn' })
      .set(ctx.authHeaders)
      .send({})
      .expect(201);

    const jobId = (queueRes.body as { data: { jobId: string } }).data.jobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId: ctx.providerOrgId,
      userId: ctx.owner.userId,
      template: PdfJobTemplate.LEARNER_COHORT,
      cohortQuery: { statusBadge: 'withdrawn' },
    });

    const statusRes = await request(app.getHttpServer())
      .get(`/api/v1/pdf/jobs/${jobId}`)
      .set(ctx.authHeaders)
      .expect(200);

    expect((statusRes.body as { data: { status: string } }).data.status).toBe(
      PdfJobStatus.COMPLETED,
    );
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
