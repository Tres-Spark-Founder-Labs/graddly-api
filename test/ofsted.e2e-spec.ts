import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { EvidencePackJobStatus } from '../src/ofsted/enums/evidence-pack-job-status.enum.js';
import { QipActionStatus } from '../src/ofsted/enums/qip-action-status.enum.js';
import { PdfJobStatus } from '../src/pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../src/pdf/enums/pdf-job-template.enum.js';

import { createVerifiedUser, loginVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { findInvitationAcceptTokenForInvitationId } from './helpers/invitation-accept-redis.js';
import { processEvidencePackJobInApp } from './helpers/process-evidence-pack-job.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';
import { createE2ePgClient } from './helpers/rls-db.js';

describe('OfstedController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns EIF criteria and scores, QIP CRUD + summary, and evidence pack job', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `ofsted-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Ofsted Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );
    const ownerUserId = owner.userId;

    const criteriaRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-criteria')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(criteriaRes.body);
    const criteria = (criteriaRes.body as { data: { slug: string }[] }).data;
    expect(criteria).toHaveLength(7);

    const scoresRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-scores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(scoresRes.body);
    const scores = (
      scoresRes.body as {
        data: {
          overallPercent: number;
          criteria: unknown[];
          cached: boolean;
        };
      }
    ).data;
    expect(scores.criteria).toHaveLength(7);
    expect(typeof scores.overallPercent).toBe('number');
    expect(scores.cached).toBe(false);

    const createQipRes = await request(app.getHttpServer())
      .post('/api/v1/qip-actions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Improve safeguarding records',
        assignedOwnerUserId: ownerUserId,
        targetCompletionDate: '2026-12-31',
        eifCriterionSlug: criteria[0].slug,
        status: QipActionStatus.NOT_STARTED,
      })
      .expect(201);

    expectSuccessEnvelope(createQipRes.body);
    const qipId = (createQipRes.body as { data: { id: string } }).data.id;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/qip-actions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    expect((listRes.body as { data: unknown[] }).data).toHaveLength(1);

    const summaryRes = await request(app.getHttpServer())
      .get('/api/v1/qip-actions/summary')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(summaryRes.body);
    expect((summaryRes.body as { data: { total: number } }).data.total).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/qip-actions/${qipId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: QipActionStatus.COMPLETED })
      .expect(200);

    const createPackRes = await request(app.getHttpServer())
      .post('/api/v1/ofsted/evidence-packs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    expectSuccessEnvelope(createPackRes.body);
    const jobId = (createPackRes.body as { data: { jobId: string } }).data
      .jobId;

    await processEvidencePackJobInApp(app, {
      jobId,
      organisationId,
      userId: ownerUserId,
      additionalStorageKeys: [],
    });

    const packStatusRes = await request(app.getHttpServer())
      .get(`/api/v1/ofsted/evidence-packs/${jobId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectSuccessEnvelope(packStatusRes.body);
    const pack = (
      packStatusRes.body as {
        data: {
          status: string;
          outputKey: string;
          downloadUrl: string;
        };
      }
    ).data;
    expect(pack.status).toBe(EvidencePackJobStatus.COMPLETED);
    expect(pack.outputKey).toContain('/export/');
    expect(pack.downloadUrl).toBeTruthy();

    /**
     * F2.1.4 AC1 — every EIF theme is accounted for in the manifest, not just
     * the ones that happened to have evidence. Two of the seven
     * (`curriculum_intent`, `safeguarding`) had no content source at all
     * until this feature, so the pack reported a score for them with nothing
     * behind it.
     */
    const manifest = (
      packStatusRes.body as {
        data: { manifest: Record<string, number> };
      }
    ).data.manifest;

    for (const slug of [
      'curriculum_intent',
      'curriculum_implementation',
      'curriculum_impact',
      'behaviour_attitudes',
      'personal_development',
      'leadership_management',
      'safeguarding',
    ]) {
      expect(manifest).toHaveProperty(slug);
    }
    expect(manifest).toHaveProperty('custom');
  });

  /**
   * F2.1.2 — the capability split is the whole point of the feature, so it is
   * asserted from both sides: a member can record progress on an action, and
   * the same member cannot edit the plan through the wide PATCH. Testing only
   * the allow half would pass just as happily if the guard were missing.
   */
  it('lets a member record progress but not edit the plan, and exports the QIP as PDF', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `qip-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`QIP Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );

    const criteriaRes = await request(app.getHttpServer())
      .get('/api/v1/ofsted/eif-criteria')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const criteria = (criteriaRes.body as { data: { slug: string }[] }).data;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/qip-actions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Tighten safeguarding checks',
        description: 'Monthly audit of every learner file',
        assignedOwnerUserId: owner.userId,
        targetCompletionDate: '2026-12-31',
        eifCriterionSlug: criteria[0].slug,
        status: QipActionStatus.NOT_STARTED,
      })
      .expect(201);

    const qipId = (createRes.body as { data: { id: string } }).data.id;

    // A tutor: member role, in the same organisation.
    const tutor = await createVerifiedUser(app, {
      email: `qip-tutor-${suffix}@example.com`,
    });

    const inviteRes = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: tutor.email, role: 'member' })
      .expect(201);

    const invitationId = (inviteRes.body as { data: { id: string } }).data.id;
    const acceptToken =
      await findInvitationAcceptTokenForInvitationId(invitationId);
    expect(acceptToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${tutor.accessToken}`)
      .send({ token: acceptToken })
      .expect(200);

    const { accessToken: tutorToken } = await loginVerifiedUser(
      app,
      tutor.email,
      tutor.password,
    );

    // Allowed: COMPLETE_QIP_ACTION includes MEMBER.
    const progressRes = await request(app.getHttpServer())
      .patch(`/api/v1/qip-actions/${qipId}/progress`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        status: QipActionStatus.COMPLETED,
        evidenceNotes: 'First audit complete',
      })
      .expect(200);

    expectSuccessEnvelope(progressRes.body);
    const updated = (
      progressRes.body as {
        data: { status: string; evidenceNotes: string; title: string };
      }
    ).data;
    expect(updated.status).toBe(QipActionStatus.COMPLETED);
    expect(updated.evidenceNotes).toBe('First audit complete');
    // The narrow DTO cannot reach the title, so it is untouched.
    expect(updated.title).toBe('Tighten safeguarding checks');

    // Refused: MANAGE_QIP is OWNER/ADMIN only.
    await request(app.getHttpServer())
      .patch(`/api/v1/qip-actions/${qipId}`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ title: 'Renamed by a tutor' })
      .expect(403);

    // AC5 — the plan as a PDF. Open to the tutor too (DOWNLOAD_EVIDENCE_PACK).
    const exportRes = await request(app.getHttpServer())
      .post('/api/v1/qip-actions/export')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({})
      .expect(201);

    expectSuccessEnvelope(exportRes.body);
    const jobId = (exportRes.body as { data: { jobId: string } }).data.jobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId,
      userId: tutor.userId,
      template: PdfJobTemplate.QIP_PLAN,
    });

    const statusRes = await request(app.getHttpServer())
      .get(`/api/v1/pdf/jobs/${jobId}`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .expect(200);

    expectSuccessEnvelope(statusRes.body);
    const job = (
      statusRes.body as { data: { status: string; outputKey: string } }
    ).data;
    expect(job.status).toBe(PdfJobStatus.COMPLETED);
    expect(job.outputKey).toContain('/export/');
  });

  /**
   * F2.1.3 — generate, edit, export as Word, lock, and prove the lock holds
   * at the database rather than only in the service.
   */
  it('generates, edits, exports and locks a SAR', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `sar-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`SAR Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );

    // AC1 — the draft, pre-populated.
    const generateRes = await request(app.getHttpServer())
      .post('/api/v1/sar-reports')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ academicYear: '2025-26' })
      .expect(201);

    expectSuccessEnvelope(generateRes.body);
    const draft = (
      generateRes.body as {
        data: {
          id: string;
          sections: { key: string; narrative: string; grade: string | null }[];
          metrics: Record<string, unknown>;
          editable: boolean;
        };
      }
    ).data;

    const sarId = draft.id;
    expect(draft.editable).toBe(true);
    expect(draft.sections.length).toBeGreaterThan(0);
    // The platform supplies evidence, never the judgement.
    expect(draft.sections.every((s) => s.grade === null)).toBe(true);
    expect(draft.metrics).toHaveProperty('eifOverallPercent');
    expect(draft.metrics).toHaveProperty('reviewComplianceRate');
    expect(draft.metrics).toHaveProperty('withdrawalRate');

    // Generating again returns the same draft rather than a second one.
    const regenerateRes = await request(app.getHttpServer())
      .post('/api/v1/sar-reports')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ academicYear: '2025-26' })
      .expect(201);
    expect((regenerateRes.body as { data: { id: string } }).data.id).toBe(
      sarId,
    );

    // AC3 — editable in the platform.
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/sar-reports/${sarId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        sections: [
          {
            key: 'safeguarding',
            narrative: 'Our safeguarding culture is strong.',
            grade: 'good',
          },
        ],
      })
      .expect(200);

    const updated = (
      updateRes.body as {
        data: { sections: { key: string; narrative: string; grade: string }[] };
      }
    ).data;
    const safeguarding = updated.sections.find((s) => s.key === 'safeguarding');
    expect(safeguarding?.narrative).toBe('Our safeguarding culture is strong.');
    expect(safeguarding?.grade).toBe('good');

    // AC3 — a real Word document, not something merely named .docx.
    const docxRes = await request(app.getHttpServer())
      .get(`/api/v1/sar-reports/${sarId}/export`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(docxRes.headers['content-type']).toContain('wordprocessingml');
    expect((docxRes.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    // AC4 — lock it.
    const lockRes = await request(app.getHttpServer())
      .post(`/api/v1/sar-reports/${sarId}/lock`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);

    const locked = (
      lockRes.body as {
        data: { status: string; lockedAt: string; editable: boolean };
      }
    ).data;
    expect(locked.status).toBe('locked');
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.editable).toBe(false);

    // Editing a locked SAR is refused by the service.
    await request(app.getHttpServer())
      .patch(`/api/v1/sar-reports/${sarId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sections: [{ key: 'safeguarding', narrative: 'changed' }] })
      .expect(409);

    // …and by the database, which is the half that actually makes it a
    // historical record. A service check is one forgotten save() away from
    // being bypassed; this is not.
    const pg = createE2ePgClient();
    await pg.connect();
    try {
      await expect(
        pg.query(
          `UPDATE sar_reports SET "academicYear" = '2099-00' WHERE id = $1`,
          [sarId],
        ),
      ).rejects.toThrow(/locked and cannot be modified/);
    } finally {
      await pg.end();
    }

    // A member may read the SAR and download it, but not write one.
    const tutor = await createVerifiedUser(app, {
      email: `sar-tutor-${suffix}@example.com`,
    });
    const inviteRes = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: tutor.email, role: 'member' })
      .expect(201);
    const invitationId = (inviteRes.body as { data: { id: string } }).data.id;
    const acceptToken =
      await findInvitationAcceptTokenForInvitationId(invitationId);
    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${tutor.accessToken}`)
      .send({ token: acceptToken })
      .expect(200);
    const { accessToken: tutorToken } = await loginVerifiedUser(
      app,
      tutor.email,
      tutor.password,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/sar-reports/${sarId}`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/sar-reports')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ academicYear: '2026-27' })
      .expect(403);

    expect(organisationId).toBeTruthy();
  });
});
