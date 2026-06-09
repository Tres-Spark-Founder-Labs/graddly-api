import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { CommitmentStatementStatus } from '../src/commitments/enums/commitment-statement-status.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { PdfJobTemplate } from '../src/pdf/enums/pdf-job-template.enum.js';
import { TripartiteParty } from '../src/signing/tripartite-party.enum.js';
import { StorageObjectCategory } from '../src/storage/enums/storage-object-category.enum.js';
import { noopStorageObjects } from '../src/storage/providers/noop-storage.store.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';

import type { App } from 'supertest/types';

describe('Commitments (e2e)', () => {
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

  async function seedOrgContext(suffix: number) {
    const owner = await createVerifiedUser(app, {
      email: `commitments-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Commitments Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `COM-PROG-${suffix}`,
        title: 'Commitments Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        programmeId,
        code: `COM-STD-${suffix}`,
        title: 'Commitments Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Commit',
        lastName: 'Apprentice',
        email: `commitments-apprentice-${suffix}@example.com`,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    return { owner, orgId, enrolmentId, apprenticeId };
  }

  const sampleContent = {
    trainingPlanSummary: '12-month digital apprenticeship plan',
    employerCommitments: 'Provide mentor and equipment',
    apprenticeCommitments: 'Complete OTJ and assessments',
    providerCommitments: 'Deliver training and reviews',
    weeklyHours: 37.5,
  };

  it('lists, updates draft, and cancels commitment statements', async () => {
    const suffix = Date.now();
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/commitment-statements')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        content: sampleContent,
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);
    expectSuccessEnvelope(createRes.body);
    const statementId = (createRes.body as { data: { id: string } }).data.id;

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/commitment-statements')
      .query({ page: 1, perPage: 10, enrolmentId })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);
    expectPaginatedListEnvelope(listRes.body);
    expect(
      (listRes.body as { data: Array<{ id: string }> }).data.some(
        (row) => row.id === statementId,
      ),
    ).toBe(true);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/commitment-statements/${statementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        content: {
          ...sampleContent,
          trainingPlanSummary: 'Updated apprenticeship plan',
        },
      })
      .expect(200);
    expectSuccessEnvelope(updateRes.body);
    expect(
      (
        updateRes.body as {
          data: { content: { trainingPlanSummary: string } };
        }
      ).data.content.trainingPlanSummary,
    ).toBe('Updated apprenticeship plan');

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/commitment-statements/${statementId}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);
    expectSuccessEnvelope(cancelRes.body);
    expect((cancelRes.body as { data: { status: string } }).data.status).toBe(
      CommitmentStatementStatus.CANCELLED,
    );
  });

  it('lifecycle: publish, sign chain, version supersede, audit export', async () => {
    const suffix = Date.now();
    const { owner, orgId, enrolmentId, apprenticeId } =
      await seedOrgContext(suffix);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/commitment-statements')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        content: sampleContent,
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const v1 = (createRes.body as { data: { id: string; groupId: string } })
      .data;
    const statementId = v1.id;
    const groupId = v1.groupId;

    const publishRes = await request(app.getHttpServer())
      .post(`/api/v1/commitment-statements/${statementId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    expectSuccessEnvelope(publishRes.body);
    const jobId = (publishRes.body as { data: { snapshotPdfJobId: string } })
      .data.snapshotPdfJobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId: orgId,
      userId: owner.userId,
      template: PdfJobTemplate.COMMITMENT_SNAPSHOT,
      statementId,
    });

    const signatureKey = `orgs/${orgId}/${StorageObjectCategory.SIGNATURE}/sig-obj/signature.png`;
    noopStorageObjects.set(signatureKey, Buffer.from('fake-signature'));

    await request(app.getHttpServer())
      .post(`/api/v1/commitment-statements/${statementId}/sign`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        party: TripartiteParty.EMPLOYER_MANAGER,
        signatureImageKey: signatureKey,
      })
      .expect(409);

    for (const party of [
      TripartiteParty.APPRENTICE,
      TripartiteParty.TUTOR,
      TripartiteParty.EMPLOYER_MANAGER,
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/commitment-statements/${statementId}/sign`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({ party, signatureImageKey: signatureKey })
        .expect(201);
    }

    const signedRes = await request(app.getHttpServer())
      .get(`/api/v1/commitment-statements/${statementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(signedRes.body);
    expect((signedRes.body as { data: { status: string } }).data.status).toBe(
      CommitmentStatementStatus.SIGNED,
    );

    const v2Res = await request(app.getHttpServer())
      .post(`/api/v1/commitment-statements/${groupId}/versions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        content: { ...sampleContent, additionalTerms: 'Updated terms' },
        apprenticeUserId: owner.userId,
        tutorUserId: owner.userId,
        employerManagerUserId: owner.userId,
      })
      .expect(201);

    expectSuccessEnvelope(v2Res.body);
    expect((v2Res.body as { data: { version: number } }).data.version).toBe(2);

    const v1After = await request(app.getHttpServer())
      .get(`/api/v1/commitment-statements/${statementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expect((v1After.body as { data: { status: string } }).data.status).toBe(
      CommitmentStatementStatus.SUPERSEDED,
    );

    const auditStatements = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'commitment_statements' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditStatements.body);
    const statementRows = (
      auditStatements.body as {
        data: Array<{ action: AuditAction; entityId: string }>;
      }
    ).data;
    expect(statementRows.some((r) => r.entityId === statementId)).toBe(true);
    expect(statementRows.some((r) => r.action === AuditAction.INSERT)).toBe(
      true,
    );
    expect(statementRows.some((r) => r.action === AuditAction.UPDATE)).toBe(
      true,
    );

    const auditSignatures = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityType: 'commitment_signatures' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(auditSignatures.body);
    const signatureRows = (
      auditSignatures.body as {
        data: Array<{ action: AuditAction; entityType: string }>;
      }
    ).data;
    expect(signatureRows.length).toBeGreaterThan(0);
    expect(
      signatureRows.every((r) => r.entityType === 'commitment_signatures'),
    ).toBe(true);
    expect(signatureRows.some((r) => r.action === AuditAction.UPDATE)).toBe(
      true,
    );
  });
});
