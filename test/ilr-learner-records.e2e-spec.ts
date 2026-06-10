import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { IlrLearnerRecordStatus } from '../src/ilr/enums/ilr-learner-record-status.enum.js';
import { IlrSubmissionStatus } from '../src/ilr/enums/ilr-submission-status.enum.js';
import { ILR_ESFA_CLIENT } from '../src/ilr/ilr.constants.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { seedIlrOrgContext } from './helpers/ilr-seed.js';
import { processIlrSubmitJobInApp } from './helpers/process-ilr-submit-job.js';

import type { App } from 'supertest/types';

type IlrRecordBody = {
  id: string;
  status: IlrLearnerRecordStatus;
  fields: Record<string, Record<string, string | null>>;
};

type IlrSubmissionBody = {
  id: string;
  status: IlrSubmissionStatus;
  esfaReference: string | null;
  isAmendment: boolean;
  amendsSubmissionId: string | null;
  receipt: Record<string, unknown> | null;
};

describe('ILR learner records (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('build + validate', () => {
    it('reports validation failures then passes after manual ULN override', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
        { invalidDates: true },
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2025-10',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/ilr/learner-records')
        .query({ page: 1, perPage: 10, enrolmentId })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      expectSuccessEnvelope(listRes.body);
      expect(
        (listRes.body as { data: Array<{ id: string }> }).data.some(
          (row) => row.id === recordId,
        ),
      ).toBe(true);

      const failValidateRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);
      expect(
        (failValidateRes.body as { data: IlrRecordBody }).data.status,
      ).toBe(IlrLearnerRecordStatus.VALIDATION_FAILED);

      const reportRes = await request(app.getHttpServer())
        .get(`/api/v1/ilr/learner-records/${recordId}/validation-report`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);
      const report = (
        reportRes.body as {
          data: { isValid: boolean; issues: { code: string }[] };
        }
      ).data;
      expect(report.isValid).toBe(false);
      expect(report.issues.some((i) => i.code === 'ILR002')).toBe(true);

      const goodContext = await seedIlrOrgContext(app, suffix + 1);
      const goodBuildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${goodContext.owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, goodContext.orgId)
        .send({
          enrolmentId: goodContext.enrolmentId,
          collectionPeriod: '2025-10',
          academicYear: '2025-26',
        })
        .expect(201);
      const goodRecordId = (goodBuildRes.body as { data: IlrRecordBody }).data
        .id;

      await request(app.getHttpServer())
        .patch(`/api/v1/ilr/learner-records/${goodRecordId}`)
        .set('Authorization', `Bearer ${goodContext.owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, goodContext.orgId)
        .send({ manualOverrides: { ['Learner.ULN']: '1234567890' } })
        .expect(200);

      const passValidateRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${goodRecordId}/validate`)
        .set('Authorization', `Bearer ${goodContext.owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, goodContext.orgId)
        .expect(201);
      expect(
        (passValidateRes.body as { data: IlrRecordBody }).data.status,
      ).toBe(IlrLearnerRecordStatus.VALIDATED);
    });
  });

  describe('submit (noop)', () => {
    it('queues submit then completes via worker with receipt', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2025-11',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const submitRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      expectSuccessEnvelope(submitRes.body);
      const queued = (submitRes.body as { data: IlrSubmissionBody }).data;
      expect(queued.status).toBe(IlrSubmissionStatus.QUEUED);

      await processIlrSubmitJobInApp(app, {
        submissionId: queued.id,
        organisationId: orgId,
        requestedByUserId: owner.userId,
      });

      const pollRes = await request(app.getHttpServer())
        .get(`/api/v1/ilr/submissions/${queued.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      const submission = (pollRes.body as { data: IlrSubmissionBody }).data;
      expect(submission.status).toBe(IlrSubmissionStatus.SUBMITTED);
      expect(submission.esfaReference).toMatch(/^NOOP-/);
      expect(submission.receipt).toEqual(
        expect.objectContaining({ provider: 'noop' }),
      );

      const auditRes = await request(app.getHttpServer())
        .get('/api/v1/audit/export')
        .query({ entityType: 'ilr_submissions' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);
      const auditRows = (auditRes.body as { data: { action: string }[] }).data;
      expect(
        auditRows.some((row) => row.action === String(AuditAction.INSERT)),
      ).toBe(true);
    });
  });

  describe('submit guards', () => {
    it('rejects submit for draft record', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2025-12',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(400);
    });
  });

  describe('amend', () => {
    it('submits amendment after re-validation', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2026-01',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const firstSubmitRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);
      const firstQueued = (firstSubmitRes.body as { data: IlrSubmissionBody })
        .data;
      const firstSubmissionId = firstQueued.id;

      await processIlrSubmitJobInApp(app, {
        submissionId: firstSubmissionId,
        organisationId: orgId,
        requestedByUserId: owner.userId,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/ilr/learner-records/${recordId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({ manualOverrides: { ['Learner.ULN']: '9876543210' } })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const amendRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/amend`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const amendQueued = (amendRes.body as { data: IlrSubmissionBody }).data;
      expect(amendQueued.isAmendment).toBe(true);
      expect(amendQueued.amendsSubmissionId).toBe(firstSubmissionId);
      expect(amendQueued.status).toBe(IlrSubmissionStatus.QUEUED);

      await processIlrSubmitJobInApp(app, {
        submissionId: amendQueued.id,
        organisationId: orgId,
        requestedByUserId: owner.userId,
      });

      const amendPollRes = await request(app.getHttpServer())
        .get(`/api/v1/ilr/submissions/${amendQueued.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      const amendSubmission = (amendPollRes.body as { data: IlrSubmissionBody })
        .data;
      expect(amendSubmission.status).toBe(IlrSubmissionStatus.SUBMITTED);
      expect(amendSubmission.receipt).toBeTruthy();
    });
  });

  describe('amend guards', () => {
    it('rejects amend without prior submission', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2026-02',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/amend`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(400);
    });
  });

  describe('submissions history', () => {
    it('lists submit and amend attempts', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2026-03',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const submitRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);
      const firstQueued = (submitRes.body as { data: IlrSubmissionBody }).data;
      await processIlrSubmitJobInApp(app, {
        submissionId: firstQueued.id,
        organisationId: orgId,
        requestedByUserId: owner.userId,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/ilr/learner-records/${recordId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({ manualOverrides: { ['Learner.ULN']: '5555555555' } })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/amend`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const historyRes = await request(app.getHttpServer())
        .get(`/api/v1/ilr/learner-records/${recordId}/submissions`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      const history = (historyRes.body as { data: IlrSubmissionBody[] }).data;
      expect(history).toHaveLength(2);
      expect(history[1].isAmendment).toBe(true);
    });
  });

  describe('notifications', () => {
    it('creates failure notification when ESFA client throws', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
      );

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          enrolmentId,
          collectionPeriod: '2026-04',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/validate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);

      const esfaClient = app.get(ILR_ESFA_CLIENT);
      jest
        .spyOn(esfaClient, 'submit')
        .mockRejectedValueOnce(new Error('Simulated ESFA failure'));

      const submitRes = await request(app.getHttpServer())
        .post(`/api/v1/ilr/learner-records/${recordId}/submit`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(201);
      const queued = (submitRes.body as { data: IlrSubmissionBody }).data;

      await expect(
        processIlrSubmitJobInApp(
          app,
          {
            submissionId: queued.id,
            organisationId: orgId,
            requestedByUserId: owner.userId,
          },
          { attemptsMade: 2 },
        ),
      ).rejects.toThrow('Simulated ESFA failure');

      const notificationsRes = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      const notifications = (
        notificationsRes.body as {
          data: { type: string; title: string }[];
        }
      ).data;
      expect(
        notifications.some((n) => n.type === 'ilr_submission_failed'),
      ).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('hides learner records from other organisations', async () => {
      const suffix = Date.now();
      const first = await seedIlrOrgContext(app, suffix);
      const second = await seedIlrOrgContext(app, suffix + 100);

      const buildRes = await request(app.getHttpServer())
        .post('/api/v1/ilr/learner-records/build')
        .set('Authorization', `Bearer ${first.owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, first.orgId)
        .send({
          enrolmentId: first.enrolmentId,
          collectionPeriod: '2026-05',
          academicYear: '2025-26',
        })
        .expect(201);
      const recordId = (buildRes.body as { data: IlrRecordBody }).data.id;

      await request(app.getHttpServer())
        .get(`/api/v1/ilr/learner-records/${recordId}`)
        .set('Authorization', `Bearer ${second.owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, second.orgId)
        .expect(404);
    });
  });
});
