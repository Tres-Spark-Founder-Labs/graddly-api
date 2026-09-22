import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module.js';
import { AuditAction } from '../src/audit/enums/audit-action.enum.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { configureApp } from '../src/configure-app.js';
import { IlrLearnerRecordStatus } from '../src/ilr/enums/ilr-learner-record-status.enum.js';
import { IlrSubmissionStatus } from '../src/ilr/enums/ilr-submission-status.enum.js';
import { ILR_ESFA_CLIENT } from '../src/ilr/ilr.constants.js';

import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { seedIlrOrgContext } from './helpers/ilr-seed.js';
import { processIlrSubmitJobInApp } from './helpers/process-ilr-submit-job.js';

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

describe('ILR (e2e)', () => {
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

  describe('mapping configs', () => {
    it('returns seeded active published config', async () => {
      const suffix = Date.now();
      const { owner, orgId } = await seedIlrOrgContext(app, suffix);

      const res = await request(app.getHttpServer())
        .get('/api/v1/ilr/mapping-configs/active')
        .query({ academicYear: '2025-26' })
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);

      expectSuccessEnvelope(res.body);
      const data = (res.body as { data: { version: number; config: object } })
        .data;
      expect(data.version).toBe(1);
      expect(data.config).toHaveProperty('entities.Learner');
    });
  });

  describe('build + validate', () => {
    it('reports validation failures then passes after manual ULN override', async () => {
      const suffix = Date.now();
      const { owner, orgId, enrolmentId } = await seedIlrOrgContext(
        app,
        suffix,
        {
          invalidDates: true,
        },
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

      const pollRes = await request(app.getHttpServer())
        .get(`/api/v1/ilr/submissions/${queued.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .expect(200);
      expect((pollRes.body as { data: IlrSubmissionBody }).data.status).toBe(
        IlrSubmissionStatus.FAILED,
      );

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

  /**
   * 5.4 — the whole return as one XML file. Every learner record in the
   * period, or a refusal that says why: no file for an empty period, none
   * while any record has not passed validation, and then every learner.
   */
  describe('return file', () => {
    it('refuses an empty period and an unvalidated learner, then returns every learner in one file', async () => {
      const suffix = Date.now();
      const seed = await seedIlrOrgContext(app, suffix);
      const as = (req: request.Test) =>
        req
          .set('Authorization', `Bearer ${seed.owner.accessToken}`)
          .set(ORGANISATION_ID_HEADER, seed.orgId);

      // A second learner in the same provider.
      const apprenticeRes = await as(
        request(app.getHttpServer()).post('/api/v1/apprentices'),
      )
        .send({
          firstName: 'Second',
          lastName: 'Learner',
          email: `ilr-return-second-${suffix}@example.com`,
        })
        .expect(201);
      const secondApprenticeId = (
        apprenticeRes.body as { data: { id: string } }
      ).data.id;
      const enrolmentRes = await as(
        request(app.getHttpServer()).post('/api/v1/enrolments'),
      )
        .send({
          apprenticeId: secondApprenticeId,
          standardId: seed.standardId,
          plannedStartDate: '2025-01-15',
          plannedEndDate: '2026-12-31',
        })
        .expect(201);
      const secondEnrolmentId = (enrolmentRes.body as { data: { id: string } })
        .data.id;
      await as(
        request(app.getHttpServer()).post(
          `/api/v1/enrolments/${secondEnrolmentId}/activate`,
        ),
      ).expect(201);

      const returnFile = () =>
        as(
          request(app.getHttpServer())
            .get('/api/v1/ilr/learner-records/return-file')
            .query({ collectionPeriod: '2025-10' }),
        );

      // Nothing built yet: no file, not an empty one.
      await returnFile().expect(404);

      const recordIds: string[] = [];
      for (const enrolmentId of [seed.enrolmentId, secondEnrolmentId]) {
        const built = await as(
          request(app.getHttpServer()).post(
            '/api/v1/ilr/learner-records/build',
          ),
        )
          .send({
            enrolmentId,
            collectionPeriod: '2025-10',
            academicYear: '2025-26',
          })
          .expect(201);
        recordIds.push((built.body as { data: IlrRecordBody }).data.id);
      }
      const validate = async (recordId: string, uln: string | null) => {
        if (uln) {
          await as(
            request(app.getHttpServer()).patch(
              `/api/v1/ilr/learner-records/${recordId}`,
            ),
          )
            .send({ manualOverrides: { ['Learner.ULN']: uln } })
            .expect(200);
        }
        const res = await as(
          request(app.getHttpServer()).post(
            `/api/v1/ilr/learner-records/${recordId}/validate`,
          ),
        ).expect(201);
        return (res.body as { data: IlrRecordBody }).data.status;
      };

      // One validated; the other built but not yet validated.
      expect(await validate(recordIds[0], '1234567890')).toBe(
        IlrLearnerRecordStatus.VALIDATED,
      );

      const refused = await returnFile().expect(409);
      expect((refused.body as { message: string }).message).toContain(
        '1 of 2 learner records for 2025-10 have not passed validation (0 failed, 1 not yet validated)',
      );

      expect(await validate(recordIds[1], '1234567891')).toBe(
        IlrLearnerRecordStatus.VALIDATED,
      );

      const ok = await returnFile().expect(200);
      expectSuccessEnvelope(ok.body);
      const file = (
        ok.body as {
          data: {
            filename: string;
            learnerCount: number;
            ukprn: string;
            academicYear: string;
            coverage: string;
            xml: string;
          };
        }
      ).data;
      expect(file.learnerCount).toBe(2);
      expect(file.ukprn).toBe(seed.ukprn);
      expect(file.academicYear).toBe('2025-26');
      expect(file.filename).toMatch(
        new RegExp(`^ILR-${seed.ukprn}-2526-\\d{8}-\\d{6}-01\\.XML$`),
      );
      expect(file.xml.match(/<Learner>/g)).toHaveLength(2);
      expect(file.xml).toContain(`<UKPRN>${seed.ukprn}</UKPRN>`);
      expect(file.xml).toContain('<ULN>1234567890</ULN>');
      expect(file.xml).toContain('<ULN>1234567891</ULN>');
      expect(file.coverage).toContain('not the full annual schema');
    });
  });
});
