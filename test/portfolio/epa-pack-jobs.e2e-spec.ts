import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { EmailDispatchService } from '../../src/email/email-dispatch.service.js';
import { EmailTemplate } from '../../src/email/email-template.enum.js';
import { EpaPackJobStatus } from '../../src/portfolio/enums/epa-pack-job-status.enum.js';
import { KsbKind } from '../../src/portfolio/enums/ksb-kind.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser } from '../helpers/e2e-http.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { processEpaPackJobInApp } from '../helpers/process-epa-pack-job.js';
import {
  addVerifiedUserToOrganisation,
  createOrgOwnerContext,
  seedProgrammeGraph,
} from '../helpers/programme-graph-e2e.js';

import type { App } from 'supertest/types';

describe('EPA evidence pack jobs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and completes an EPA evidence pack job', async () => {
    const suffix = Date.now();
    const apprentice = await createVerifiedUser(app, {
      email: `epa-pack-apprentice-${suffix}@example.com`,
    });
    const { orgId, authHeaders } = await createOrgOwnerContext(
      app,
      `EPA Pack Org ${suffix}`,
    );
    await addVerifiedUserToOrganisation(app, authHeaders, apprentice);
    const { apprenticeId, standardId } = await seedProgrammeGraph(
      app,
      authHeaders,
      { suffix, apprenticeEmail: apprentice.email },
    );

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set(authHeaders)
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(authHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set(authHeaders)
      .send({ apprenticeUserId: apprentice.userId })
      .expect(200);

    const ksbRes = await request(app.getHttpServer())
      .post(`/api/v1/standards/${standardId}/ksb-definitions`)
      .set(authHeaders)
      .send({ code: 'K1', kind: KsbKind.KNOWLEDGE, title: 'Knowledge 1' })
      .expect(201);
    const ksbId = (ksbRes.body as { data: { id: string } }).data.id;

    const evidenceRes = await request(app.getHttpServer())
      .post('/api/v1/ksb-evidence-items')
      .set(authHeaders)
      .send({
        enrolmentId,
        apprenticeId,
        type: 'text',
        title: 'EPA reflection',
        body: 'Accepted reflective statement for EPA pack.',
        ksbDefinitionIds: [ksbId],
      })
      .expect(201);
    const evidenceId = (evidenceRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/ksb-evidence-items/${evidenceId}/submit`)
      .set(authHeaders)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/ksb-evidence-items/${evidenceId}/review`)
      .set(authHeaders)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/ksb-evidence-items/${evidenceId}/accept`)
      .set(authHeaders)
      .expect(201);

    const createPackRes = await request(app.getHttpServer())
      .post('/api/v1/portfolio/epa-pack-jobs')
      .set('Authorization', `Bearer ${apprentice.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ enrolmentId })
      .expect(201);

    expectSuccessEnvelope(createPackRes.body);
    const jobId = (createPackRes.body as { data: { jobId: string } }).data
      .jobId;

    // F3.3.4 AC5 — the download link is also emailed. The email queue is the
    // double; everything up to it (the claim, the presign, the preference
    // check, the payload) is real.
    const enqueue = jest
      .spyOn(app.get(EmailDispatchService), 'enqueue')
      .mockResolvedValue(undefined);

    const payload = {
      jobId,
      organisationId: orgId,
      userId: apprentice.userId,
      enrolmentId,
    };
    await processEpaPackJobInApp(app, payload);

    const packStatusRes = await request(app.getHttpServer())
      .get(`/api/v1/portfolio/epa-pack-jobs/${jobId}`)
      .set('Authorization', `Bearer ${apprentice.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(packStatusRes.body);
    const pack = (
      packStatusRes.body as {
        data: {
          status: string;
          outputKey: string;
          downloadUrl: string;
          manifest: Record<string, number>;
          downloadEmailSentAt: string | null;
        };
      }
    ).data;
    expect(pack.status).toBe(EpaPackJobStatus.COMPLETED);
    expect(pack.outputKey).toContain('/export/');
    expect(pack.downloadUrl).toBeTruthy();
    expect(pack.manifest.knowledge).toBeGreaterThan(0);

    // One email, to the requester, carrying a presigned link and its expiry.
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [email] = enqueue.mock.calls[0];
    expect(email.template).toBe(EmailTemplate.EPA_PACK_READY);
    expect(email.to).toBe(apprentice.email);
    const context = email.getTemplateContext() as {
      downloadUrl: string;
      expiresInLabel: string;
      expiresAtLabel: string;
    };
    expect(decodeURIComponent(context.downloadUrl)).toContain(pack.outputKey);
    expect(context.expiresInLabel).toBe('24 hours');
    expect(context.expiresAtLabel).toMatch(
      /^\d{1,2} \w{3,4} \d{4}, \d{2}:\d{2}$/u,
    );
    expect(pack.downloadEmailSentAt).toBeTruthy();

    // A re-delivered job rebuilds the pack but does not email twice: the
    // sent marker is persisted, not inferred from the queue.
    await processEpaPackJobInApp(app, payload);
    const retriedRes = await request(app.getHttpServer())
      .get(`/api/v1/portfolio/epa-pack-jobs/${jobId}`)
      .set('Authorization', `Bearer ${apprentice.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);
    const retried = (
      retriedRes.body as {
        data: { status: string; downloadEmailSentAt: string | null };
      }
    ).data;
    expect(retried.status).toBe(EpaPackJobStatus.COMPLETED);
    expect(retried.downloadEmailSentAt).toBe(pack.downloadEmailSentAt);
    expect(enqueue).toHaveBeenCalledTimes(1);
    enqueue.mockRestore();
  });
});
