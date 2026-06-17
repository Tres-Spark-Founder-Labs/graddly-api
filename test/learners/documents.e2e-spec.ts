import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { KsbKind } from '../../src/portfolio/enums/ksb-kind.enum.js';
import { noopStorageObjects } from '../../src/storage/providers/noop-storage.store.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser } from '../helpers/e2e-http.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import {
  addVerifiedUserToOrganisation,
  createOrgOwnerContext,
  seedProgrammeGraph,
} from '../helpers/programme-graph-e2e.js';
import { createE2ePgClient } from '../helpers/rls-db.js';

import type { App } from 'supertest/types';

describe('Learner documents (e2e)', () => {
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

  it('returns accepted evidence with presigned download URLs for the apprentice', async () => {
    const suffix = Date.now();
    const apprentice = await createVerifiedUser(app, {
      email: `learner-docs-${suffix}@example.com`,
    });
    const { orgId, authHeaders } = await createOrgOwnerContext(
      app,
      `Learner Docs Org ${suffix}`,
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

    const storageKey = `orgs/${orgId}/learners/${apprenticeId}/evidence/obj1/sample.pdf`;
    noopStorageObjects.set(storageKey, Buffer.from('%PDF-1.4 sample'));

    const evidenceRes = await request(app.getHttpServer())
      .post('/api/v1/ksb-evidence-items')
      .set(authHeaders)
      .send({
        enrolmentId,
        apprenticeId,
        type: 'file',
        title: 'Signed evidence file',
        storageKey,
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

    const pg = createE2ePgClient();
    await pg.connect();
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const reviewPdfKey = `orgs/${orgId}/learners/${apprenticeId}/reviews/obj1/review.pdf`;
      noopStorageObjects.set(reviewPdfKey, Buffer.from('%PDF-1.4 review'));
      await pg.query(
        `INSERT INTO reviews (
          id, "createdAt", "updatedAt", "organisationId", "enrolmentId", "apprenticeId",
          "scheduledAt", status, "isOverdue", "apprenticeUserId", "tutorUserId",
          "employerManagerUserId", "finalSignedPdfKey", "isDeleted"
        ) VALUES (
          uuid_generate_v4(), now(), now(), $1, $2, $3,
          '2026-03-01', 'completed', false, $4, $4, $4, $5, false
        )`,
        [orgId, enrolmentId, apprenticeId, apprentice.userId, reviewPdfKey],
      );
    } finally {
      await pg.end();
    }

    const docsRes = await request(app.getHttpServer())
      .get('/api/v1/learners/me/documents')
      .set('Authorization', `Bearer ${apprentice.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(docsRes.body);
    const data = (
      docsRes.body as {
        data: {
          enrolments: Array<{
            enrolmentId: string;
            items: Array<{
              type: string;
              downloadUrl?: string;
            }>;
          }>;
        };
      }
    ).data;

    expect(data.enrolments).toHaveLength(1);
    expect(data.enrolments[0]?.enrolmentId).toBe(enrolmentId);
    const types = data.enrolments[0]?.items.map((i) => i.type) ?? [];
    expect(types).toContain('evidence');
    expect(types).toContain('review');
    const withDownload =
      data.enrolments[0]?.items.filter((i) => i.downloadUrl) ?? [];
    expect(withDownload.length).toBeGreaterThanOrEqual(2);
  });
});
