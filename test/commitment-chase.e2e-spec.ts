import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { CommitmentChaseService } from '../src/commitments/commitment-chase.service.js';
import { CommitmentChaseDispatch } from '../src/commitments/entities/commitment-chase-dispatch.entity.js';
import { CommitmentSignature } from '../src/commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementStatus } from '../src/commitments/enums/commitment-statement-status.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';
import { EmailDispatchService } from '../src/email/email-dispatch.service.js';
import { PdfJobTemplate } from '../src/pdf/enums/pdf-job-template.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';

import type { App } from 'supertest/types';
import type { Repository } from 'typeorm';

describe('Commitment chase (e2e)', () => {
  let app: INestApplication<App>;
  let signatureRepo: Repository<CommitmentSignature>;
  let dispatchRepo: Repository<CommitmentChaseDispatch>;

  beforeAll(async () => {
    app = await createE2eApp();
    signatureRepo = app.get(getRepositoryToken(CommitmentSignature));
    dispatchRepo = app.get(getRepositoryToken(CommitmentChaseDispatch));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends chase for unsigned pending signature after 7 days', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `chase-owner-${suffix}@example.com`,
    });
    const tutor = await createVerifiedUser(app, {
      email: `chase-tutor-${suffix}@example.com`,
    });
    const manager = await createVerifiedUser(app, {
      email: `chase-manager-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Chase Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `CHASE-PROG-${suffix}`,
        title: 'Chase Programme',
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
        code: `CHASE-STD-${suffix}`,
        title: 'Chase Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Chase',
        lastName: 'Apprentice',
        email: `chase-apprentice-${suffix}@example.com`,
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

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/commitment-statements')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        apprenticeUserId: owner.userId,
        tutorUserId: tutor.userId,
        employerManagerUserId: manager.userId,
        content: {
          trainingPlanSummary: 'Plan',
          employerCommitments: 'Employer',
          apprenticeCommitments: 'Apprentice',
          providerCommitments: 'Provider',
        },
      })
      .expect(201);
    const statementId = (createRes.body as { data: { id: string } }).data.id;

    const publishRes = await request(app.getHttpServer())
      .post(`/api/v1/commitment-statements/${statementId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);
    const jobId = (publishRes.body as { data: { snapshotPdfJobId: string } })
      .data.snapshotPdfJobId;

    await processPdfJobInApp(app, {
      jobId,
      organisationId: orgId,
      userId: owner.userId,
      template: PdfJobTemplate.COMMITMENT_SNAPSHOT,
      statementId,
    });

    setCurrentOrganisationId(orgId);
    setCurrentUserId(owner.userId);
    setLastKnownUserIdForGuc(owner.userId);

    const signatures = await signatureRepo.find({
      where: { statementId, organisationId: orgId },
      order: { signOrder: 'ASC' },
    });
    expect(signatures.length).toBeGreaterThan(0);

    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await signatureRepo.update(signatures[0].id, {
      createdAt: stale,
      updatedAt: stale,
    });

    const emailSpy = jest
      .spyOn(app.get(EmailDispatchService), 'enqueue')
      .mockResolvedValue(undefined);

    const chaseService = app.get(CommitmentChaseService);
    const sent = await chaseService.sendDueChases();

    expect(sent).toBe(1);
    expect(emailSpy).toHaveBeenCalled();

    const dispatch = await dispatchRepo.findOne({
      where: { signatureId: signatures[0].id, isDeleted: false },
    });
    expect(dispatch).toBeTruthy();

    const showRes = await request(app.getHttpServer())
      .get(`/api/v1/commitment-statements/${statementId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expect((showRes.body as { data: { status: string } }).data.status).toBe(
      CommitmentStatementStatus.AWAITING_SIGNATURES,
    );

    emailSpy.mockRestore();
  });
});
