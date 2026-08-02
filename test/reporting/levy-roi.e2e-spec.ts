import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../src/common/context/correlation-id-context.js';
import { DasHttpClient } from '../../src/das/das-http.client.js';
import { DasLevySyncService } from '../../src/das/das-levy-sync.service.js';
import { setLastKnownUserIdForGuc } from '../../src/database/apply-tenant-gucs.js';
import { PdfJobStatus } from '../../src/pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../../src/pdf/enums/pdf-job-template.enum.js';
import { noopStorageObjects } from '../../src/storage/providers/noop-storage.store.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  expectLevyRoiBreakdownEntryResource,
  expectLevyRoiReportResource,
} from '../helpers/reporting-contracts.js';
import {
  createEmployerReportingContext,
  createProviderDirectoryContext,
  processPdfJobInApp,
} from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('LevyRoiReportController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    noopStorageObjects.clear();
  });

  it('GET /reporting/levy-roi returns summary for employer org', async () => {
    const ctx = await createEmployerReportingContext(app, 'summary');

    const client = app.get(DasHttpClient);
    jest.spyOn(client, 'fetchLevyBalance').mockResolvedValue({
      accountId: 'das-account-roi',
      balance: '10000.00',
      currency: 'GBP',
      raw: {
        monthlyContributions: [{ month: '2025-12', amount: 2000 }],
        transactions: [{ month: '2025-12', spend: 750 }],
      },
    });

    const syncService = app.get(DasLevySyncService);
    setCurrentOrganisationId(ctx.employerOrgId);
    setCurrentUserId(ctx.owner.userId);
    setLastKnownUserIdForGuc(ctx.owner.userId);
    await syncService.syncOrganisation(ctx.employerOrgId, ctx.owner.userId);

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-roi')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expectLevyRoiReportResource(res.body.data);
    expect(res.body.data.organisationId).toBe(ctx.employerOrgId);
    expect(res.body.data.activeApprenticeCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.monthlyContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ month: '2025-12', amount: 2000 }),
      ]),
    );
  });

  it('GET /reporting/levy-roi/breakdown returns provider rows', async () => {
    const ctx = await createEmployerReportingContext(app, 'breakdown');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-roi/breakdown')
      .query({ groupBy: 'provider' })
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expectLevyRoiBreakdownEntryResource(res.body.data[0]);
  });

  /**
   * F1.4.2 AC3. The route existed and returned 200, but the global response
   * interceptor wrapped the CSV string in the JSON success envelope, so the
   * downloaded file began `{"message":"Success","data":"Provider,Active…` —
   * a .csv that no spreadsheet opens. Nothing caught it because a 200 with a
   * body looks like success, and the route had no e2e coverage at all.
   */
  it('GET /reporting/levy-roi/provider-comparison.csv returns raw CSV, not an envelope', async () => {
    const ctx = await createEmployerReportingContext(app, 'comparison-csv');

    const res = await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-roi/provider-comparison.csv')
      .set(ctx.authHeaders)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text.startsWith('{')).toBe(false);
    // First cell of the header row, so this is a real CSV document.
    expect(res.text.split('\n')[0]).toMatch(/^[A-Za-z]/);
  });

  it('POST /reporting/levy-roi/export queues and completes PDF job', async () => {
    const ctx = await createEmployerReportingContext(app, 'export');

    const exportRes = await request(app.getHttpServer())
      .post('/api/v1/reporting/levy-roi/export')
      .set(ctx.authHeaders)
      .expect(201);

    expectSuccessEnvelope(exportRes.body);
    const jobId = (exportRes.body as { data: { jobId: string } }).data.jobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId: ctx.employerOrgId,
      userId: ctx.owner.userId,
      template: PdfJobTemplate.LEVY_ROI_REPORT,
    });

    const jobRes = await request(app.getHttpServer())
      .get(`/api/v1/pdf/jobs/${jobId}`)
      .set(ctx.authHeaders)
      .expect(200);

    expect(jobRes.body.data.status).toBe(PdfJobStatus.COMPLETED);
    expect(jobRes.body.data.outputKey).toBeTruthy();
  });

  it('returns 403 when active org is a provider portal', async () => {
    const ctx = await createProviderDirectoryContext(app, 'forbidden-roi');

    await request(app.getHttpServer())
      .get('/api/v1/reporting/levy-roi')
      .set(ctx.authHeaders)
      .expect(403);
  });
});
