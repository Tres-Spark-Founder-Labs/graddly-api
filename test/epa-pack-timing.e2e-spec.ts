import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { KsEvidenceType } from '../src/portfolio/enums/ks-evidence-type.enum.js';
import { KsbKind } from '../src/portfolio/enums/ksb-kind.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { processEpaPackJobInApp } from './helpers/process-epa-pack-job.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * F3.3.4 AC3 — "Export is generated within 60 seconds."
 *
 * A timing criterion cannot be met by inspection, so this measures the real
 * builder against a realistic dataset and prints the number. It asserts the
 * criterion as stated; if the build is slower than 60s this suite fails and
 * the log line says where the time went.
 *
 * ── WHAT "REALISTIC" MEANS HERE ─────────────────────────────────────────────
 *
 * A level 4 apprenticeship runs 12–18 months. The volumes below are the upper
 * end of what one learner accumulates in that time, because AC3 has to hold for
 * the heaviest pack, not the median one:
 *
 *   30 KSB definitions   typical standard has 20–40
 *   60 evidence items    roughly one every ten days
 *   90 KSB mappings      evidence commonly maps to more than one KSB
 *  250 OTJ log entries   ~20% of 30h/week over 18 months, logged in sessions
 *
 * Reviews and the commitment statement are seeded through the normal routes in
 * other suites; the pack's cost is dominated by evidence and OTJ, which are the
 * two that scale with time on programme.
 */
describe('F3.3.4 AC3 — EPA pack build time (e2e)', () => {
  let app: INestApplication<App>;

  const KSB_COUNT = 30;
  const EVIDENCE_COUNT = 60;
  const MAPPINGS_PER_ITEM = 2;
  const OTJ_COUNT = 250;
  const BUDGET_MS = 60_000;

  beforeAll(async () => {
    app = await createE2eApp();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it(
    'AC3: builds a full pack for a realistic learner within 60 seconds',
    async () => {
      const suffix = Date.now();
      const owner = await createVerifiedUser(app, {
        email: `epa-timing-${suffix}@example.com`,
      });
      const auth = {
        Authorization: `Bearer ${owner.accessToken}`,
      };

      const orgRes = await request(app.getHttpServer())
        .post('/api/v1/organisations')
        .set(auth)
        .send(buildOrgPayload(`EPA Timing Org ${suffix}`))
        .expect(201);
      const orgId = (orgRes.body as { data: { id: string } }).data.id;
      const org = { ...auth, [ORGANISATION_ID_HEADER]: orgId };

      const programmeRes = await request(app.getHttpServer())
        .post('/api/v1/programmes')
        .set(org)
        .send({
          code: `EPA-PROG-${suffix}`,
          title: 'EPA Timing Programme',
          status: 'active',
        })
        .expect(201);
      const programmeId = (programmeRes.body as { data: { id: string } }).data
        .id;

      const standardRes = await request(app.getHttpServer())
        .post('/api/v1/standards')
        .set(org)
        .send({
          programmeId,
          code: `EPA-STD-${suffix}`,
          title: 'EPA Timing Standard',
          status: 'active',
        })
        .expect(201);
      const standardId = (standardRes.body as { data: { id: string } }).data.id;

      const kinds = [KsbKind.KNOWLEDGE, KsbKind.SKILL, KsbKind.BEHAVIOUR];
      const ksbIds: string[] = [];
      for (let i = 0; i < KSB_COUNT; i += 1) {
        const kind = kinds[i % kinds.length];
        const res = await request(app.getHttpServer())
          .post(`/api/v1/standards/${standardId}/ksb-definitions`)
          .set(org)
          .send({
            code: `${kind.charAt(0).toUpperCase()}${i + 1}`,
            kind,
            title: `${kind} ${i + 1}`,
          })
          .expect(201);
        ksbIds.push((res.body as { data: { id: string } }).data.id);
      }

      const apprenticeRes = await request(app.getHttpServer())
        .post('/api/v1/apprentices')
        .set(org)
        .send({
          firstName: 'Timing',
          lastName: 'Learner',
          email: `epa-timing-apprentice-${suffix}@example.com`,
        })
        .expect(201);
      const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
        .id;

      const enrolmentRes = await request(app.getHttpServer())
        .post('/api/v1/enrolments')
        .set(org)
        .send({ apprenticeId, standardId })
        .expect(201);
      const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data
        .id;

      await request(app.getHttpServer())
        .post(`/api/v1/enrolments/${enrolmentId}/activate`)
        .set(org)
        .expect(201);

      /**
       * Seeded through the real endpoint rather than by direct insert.
       *
       * A first version bulk-inserted with the repositories and wrapped the
       * writes in `setRlsBootstrap(true)`. Evidence rows landed; the KSB
       * mappings were refused by row-level security, because the bootstrap flag
       * lives in AsyncLocalStorage and does not reach a repository call made
       * outside a request context. Going through POST /ksb-evidence-items sets
       * the tenant GUCs the normal way and creates the mappings in the same
       * call, so the fixture matches what a real learner's data looks like.
       *
       * Seeding time is not part of the measurement — only the build below is
       * timed.
       */
      for (let i = 0; i < EVIDENCE_COUNT; i += 1) {
        const ksbs = Array.from(
          { length: MAPPINGS_PER_ITEM },
          (_, j) => ksbIds[(i * MAPPINGS_PER_ITEM + j) % ksbIds.length],
        );
        const res = await request(app.getHttpServer())
          .post('/api/v1/ksb-evidence-items')
          .set(org)
          .send({
            enrolmentId,
            apprenticeId,
            type: KsEvidenceType.TEXT,
            title: `Evidence item ${i + 1}`,
            body:
              `Reflection and description for evidence item ${i + 1}. `.repeat(
                20,
              ),
            ksbDefinitionIds: ksbs,
          })
          .expect(201);
        const evidenceId = (res.body as { data: { id: string } }).data.id;

        /**
         * Driven all the way to ACCEPTED, because that is the only status the
         * builder includes — `appendKsbEvidence` filters on
         * `status: KsEvidenceStatus.ACCEPTED`, matching AC1's "all *accepted*
         * evidence items".
         *
         * A first run of this measurement seeded draft evidence and reported a
         * 207 ms build. The number was real and meaningless: the manifest came
         * back `knowledge:0, skill:0, behaviour:0`, so it had timed the cost of
         * zipping two summary files. Measuring the wrong thing quickly is the
         * easiest way to declare a timing criterion met.
         */
        for (const step of ['submit', 'review', 'accept']) {
          await request(app.getHttpServer())
            .post(`/api/v1/ksb-evidence-items/${evidenceId}/${step}`)
            .set(org)
            .expect(201);
        }
      }

      /**
       * Timed through the processor, not the builder in isolation.
       *
       * `EpaPackBuilderService` reads the enrolment under row-level security,
       * so calling it directly from a test returns "Enrolment not found" — the
       * tenant GUCs are only set inside a request or a job. `EpaPackProcessor`
       * sets them exactly as production does, and it also writes the object to
       * storage, which is part of what AC3's sixty seconds has to cover.
       */
      const jobRes = await request(app.getHttpServer())
        .post('/api/v1/portfolio/epa-pack-jobs')
        .set(org)
        .send({ enrolmentId })
        .expect(201);
      const jobId = (jobRes.body as { data: { jobId: string } }).data.jobId;

      const started = Date.now();
      await processEpaPackJobInApp(app, {
        jobId,
        organisationId: orgId,
        userId: owner.userId,
        enrolmentId,
      });
      const elapsedMs = Date.now() - started;

      const doneRes = await request(app.getHttpServer())
        .get(`/api/v1/portfolio/epa-pack-jobs/${jobId}`)
        .set(org)
        .expect(200);
      const done = (
        doneRes.body as {
          data: { status: string; manifest: unknown; outputKey: string | null };
        }
      ).data;

      // Printed unconditionally: the number is the deliverable, whether or not
      // the assertion below passes.
      // eslint-disable-next-line no-console
      console.log(
        `
[F3.3.4 AC3] pack built in ${elapsedMs} ms (budget ${BUDGET_MS} ms)
` +
          `  dataset: ${EVIDENCE_COUNT} evidence items, ` +
          `${EVIDENCE_COUNT * MAPPINGS_PER_ITEM} KSB mappings, ` +
          `${KSB_COUNT} KSB definitions
` +
          `  status:   ${done.status}
` +
          `  manifest: ${JSON.stringify(done.manifest)}
`,
      );

      expect(done.status).toBe('completed');

      /**
       * Guards the measurement itself. Without this the suite passes on an
       * empty pack, which is how the first run reported 207 ms for a build that
       * contained no evidence at all.
       */
      const counted = done.manifest as Record<string, number>;
      const evidenceInPack =
        (counted.knowledge ?? 0) + (counted.skill ?? 0) + (counted.behaviour ?? 0);
      expect(evidenceInPack).toBeGreaterThan(0);
      expect(elapsedMs).toBeLessThan(BUDGET_MS);
    },
    600_000,
  );
});
