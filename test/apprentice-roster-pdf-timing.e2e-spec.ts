import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';

import { QUEUE_PDF } from '../src/bullmq/bullmq.constants.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { PdfJobStatus } from '../src/pdf/enums/pdf-job-status.enum.js';
import { PdfService } from '../src/pdf/pdf.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { IApprenticeRosterContent } from '../src/pdf/interfaces/pdf-renderer.interface.js';
import type { IPdfJobPayload } from '../src/pdf/pdf-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { App } from 'supertest/types';

/**
 * F1.2.1 AC6 — "Table is exportable as CSV and PDF" — against the platform's
 * PDF target: "PDF report generation < 10 seconds, measured at trigger to
 * download-ready" (PRD §9, P1 and P2).
 *
 * Modelled on test/epa-pack-timing.e2e-spec.ts: a timing criterion cannot be
 * met by inspection, so this measures the real endpoint, processor, renderer
 * and storage write against the heaviest roster the PRD names and prints the
 * number whether or not the assertion passes.
 *
 * ── WHAT IS TIMED ───────────────────────────────────────────────────────────
 *
 * Trigger to download-ready: the POST that queues the export, the processor
 * run, and the GET that returns the completed job with its download URL. The
 * e2e application does not boot the worker, so the processor is run inline;
 * time spent waiting in a real queue behind other jobs is not in the number.
 *
 * ── WHAT "REALISTIC" MEANS HERE ─────────────────────────────────────────────
 *
 * F1.2.1 AC7 sets the roster's scale: "up to 500 apprentices". Five hundred
 * are seeded for the employer, plus a near miss — apprentices at the same
 * provider whose enrolments name a different employer — so the document is
 * checked against the right tenant as well as the right size.
 *
 * ── THE ROWS ARE THE SCREEN'S ───────────────────────────────────────────────
 *
 * The export is made with a status pill, a search and a sort, and the rows
 * the renderer received are compared with the list computed here from the
 * seed, in order. That list is derived from the seed's own arithmetic, not
 * from `apprentice-roster.rules.ts`, so the check is not the code grading
 * itself.
 */
const AUTH_HEADER = 'Authorization';

describe('F1.2.1 AC6 — apprentice roster PDF generation time (e2e)', () => {
  let app: INestApplication<App>;

  const ROSTER_SIZE = 500;
  const NEAR_MISS_SIZE = 20;
  const BUDGET_MS = 10_000;

  beforeAll(async () => {
    app = await createE2eApp();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('exports a 500-apprentice roster, as filtered and sorted on screen, within 10 seconds', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `roster-timing-${suffix}@example.com`,
    });
    const auth = { [AUTH_HEADER]: `Bearer ${owner.accessToken}` };

    const createOrg = async (label: string, portalType: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/organisations')
        .set(auth)
        .send({ ...buildOrgPayload(`${label} ${suffix}`), portalType })
        .expect(201);
      return (res.body as { data: { id: string } }).data.id;
    };
    const providerOrgId = await createOrg('Roster Provider', 'provider');
    const employerOrgId = await createOrg('Roster Employer', 'employer');
    const otherEmployerOrgId = await createOrg('Other Employer', 'employer');

    const provider = { ...auth, [ORGANISATION_ID_HEADER]: providerOrgId };
    const employer = { ...auth, [ORGANISATION_ID_HEADER]: employerOrgId };

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set(provider)
      .send({
        code: `ROSTER-PROG-${suffix}`,
        title: 'Roster Timing Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;
    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set(provider)
      .send({
        programmeId,
        code: `ROSTER-STD-${suffix}`,
        title: 'Roster Timing Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    /**
     * Bulk-seeded as the migration role. Five hundred apprentices through
     * POST /apprentices and /enrolments would take minutes and measure
     * nothing more: seeding is not timed, and the rows land exactly as the
     * endpoints would write them (apprentice owned by the provider,
     * enrolment naming the employer).
     *
     *   i % 3   pace level: 0 on_track, 1 at_risk, 2 off_track
     *   i % 7   0 → no EPA date; otherwise 2026-10-01 plus i days
     */
    const sudo = createE2ePgClient();
    await sudo.connect();
    try {
      const seed = async (
        count: number,
        employerId: string,
        namePrefix: string,
      ) => {
        await sudo.query(
          `WITH seeded AS (
               INSERT INTO apprentices ("organisationId", "firstName", "lastName", email, "employeeId", "createdAt")
               SELECT $1, $2, lpad(i::text, 3, '0'),
                      $3 || '-' || i || '@example.com', 'EMP-' || lpad(i::text, 5, '0'),
                      now() - (i || ' seconds')::interval
                 FROM generate_series(1, $4::int) AS i
               RETURNING id, "lastName"
             )
             INSERT INTO enrolments
               ("organisationId", "apprenticeId", "standardId", status,
                "employerOrganisationId", "otjPaceAlertLevel", "epaDate",
                "plannedStartDate")
             SELECT $1, s.id, $5, 'active', $6,
                    (ARRAY['on_track','at_risk','off_track'])[(s."lastName"::int % 3) + 1]::otj_pace_alert_level,
                    CASE WHEN s."lastName"::int % 7 = 0 THEN NULL
                         ELSE DATE '2026-10-01' + s."lastName"::int END,
                    DATE '2025-09-01'
               FROM seeded s`,
          [
            providerOrgId,
            namePrefix,
            `roster-${namePrefix}-${suffix}`.toLowerCase(),
            count,
            standardId,
            employerId,
          ],
        );
      };
      await seed(ROSTER_SIZE, employerOrgId, 'Roster');
      await seed(NEAR_MISS_SIZE, otherEmployerOrgId, 'Stranger');
    } finally {
      await sudo.end();
    }

    /**
     * The screen state: the "At risk" pill, a search, EPA date descending.
     * Expected rows from the seed's arithmetic: at_risk is i % 3 === 1;
     * every seeded name contains "roster"; EPA descending puts the latest
     * date first and the undated (i % 7 === 0) rows last, in roster order
     * (newest first, which is ascending i, since row i was created i
     * seconds ago).
     */
    const screen = {
      filter: 'at_risk',
      search: 'ROSTER',
      sortBy: 'epaDate',
      sortOrder: 'desc',
    };
    const atRisk = Array.from({ length: ROSTER_SIZE }, (_, k) => k + 1).filter(
      (i) => i % 3 === 1,
    );
    const dated = atRisk.filter((i) => i % 7 !== 0).sort((a, b) => b - a);
    const undated = atRisk.filter((i) => i % 7 === 0).sort((a, b) => a - b);
    const expectedNames = [...dated, ...undated].map(
      (i) => `Roster ${String(i).padStart(3, '0')}`,
    );

    const queue = app.get<Queue>(getQueueToken(QUEUE_PDF));
    const add = jest.spyOn(queue, 'add');
    const render = jest.spyOn(app.get(PdfService), 'renderApprenticeRoster');

    const started = Date.now();
    const exportRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices/roster/export')
      .set(employer)
      .send(screen)
      .expect(201);
    const jobId = (exportRes.body as { data: { jobId: string } }).data.jobId;

    // The payload as queued, so the screen state is proven to travel with
    // the job rather than being handed to the processor by this test.
    const queued = add.mock.calls.find(
      ([, data]) => (data as IPdfJobPayload).jobId === jobId,
    );
    expect(queued).toBeDefined();
    await processPdfJobInApp(app, queued![1] as IPdfJobPayload);

    const jobRes = await request(app.getHttpServer())
      .get(`/api/v1/pdf/jobs/${jobId}`)
      .set(employer)
      .expect(200);
    const elapsedMs = Date.now() - started;
    const job = (
      jobRes.body as {
        data: { status: string; downloadUrl?: string | null };
      }
    ).data;

    const printed = render.mock.calls[0]?.[0] as
      | IApprenticeRosterContent
      | undefined;
    add.mockRestore();
    render.mockRestore();

    // Printed unconditionally: the number is the deliverable.
    // eslint-disable-next-line no-console
    console.log(
      `\n[F1.2.1 AC6] roster PDF trigger-to-download-ready in ${elapsedMs} ms (budget ${BUDGET_MS} ms)\n` +
        `  roster:  ${ROSTER_SIZE} apprentices for the employer, ${NEAR_MISS_SIZE} near misses\n` +
        `  printed: ${printed?.totalCount ?? '?'} rows (${JSON.stringify(screen)})\n` +
        `  status:  ${job.status}\n`,
    );

    expect(job.status).toBe(PdfJobStatus.COMPLETED);
    expect(job.downloadUrl).toBeTruthy();

    // Guards the measurement: timing an empty document proves nothing.
    expect(printed).toBeDefined();
    expect(printed!.rows.map((r) => r.name)).toEqual(expectedNames);
    expect(printed!.totalCount).toBe(expectedNames.length);
    expect(printed!.rows.every((r) => r.statusLabel === 'At risk')).toBe(true);
    expect(printed!.filterSummary).toBe('search "ROSTER", status At risk');
    expect(printed!.sortSummary).toBe('Sorted by EPA date, descending.');
    // The near miss: same provider, another employer, never printed.
    expect(printed!.rows.some((r) => r.name.startsWith('Stranger'))).toBe(
      false,
    );

    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  }, 600_000);
});
