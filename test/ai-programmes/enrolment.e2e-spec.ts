import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AI_PROGRAMME_CATALOGUE_SEED } from '../helpers/ai-programme-seed.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { createFlowSmeContext } from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('AiProgrammeEnrolmentController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /ai-programmes/enrolments creates enrolment and progress rows', async () => {
    const ctx = await createFlowSmeContext(app, 'ai-enrol');
    const programmeId = AI_PROGRAMME_CATALOGUE_SEED.programmes[0].id;
    const suffix = Date.now();

    const res = await request(app.getHttpServer())
      .post('/api/v1/ai-programmes/enrolments')
      .set(ctx.authHeaders)
      .send({
        programmeId,
        firstName: 'AI',
        lastName: 'Learner',
        email: `ai-learner-${suffix}@example.com`,
        plannedStartDate: '2026-09-01',
      })
      .expect(201);

    expectSuccessEnvelope(res.body);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        enrolmentId: expect.any(String),
        programmeId,
        status: 'active',
        progressModuleCount: 3,
        providerOrganisationId: AI_PROGRAMME_CATALOGUE_SEED.providerOrgId,
      }),
    );

    const progressRes = await request(app.getHttpServer())
      .get(
        `/api/v1/ai-programmes/enrolments/${res.body.data.enrolmentId}/progress`,
      )
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(progressRes.body);
    expect(progressRes.body.data.modules).toHaveLength(3);
    expect(progressRes.body.data.percentComplete).toBe(0);
  });
});
