import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AI_PROGRAMME_CATALOGUE_SEED } from '../helpers/ai-programme-seed.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { createFlowSmeContext } from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('AiProgrammeProgressController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function enrolAiLearner(label: string) {
    const ctx = await createFlowSmeContext(app, label);
    const programmeId = AI_PROGRAMME_CATALOGUE_SEED.programmes[0].id;
    const suffix = Date.now();

    const enrolRes = await request(app.getHttpServer())
      .post('/api/v1/ai-programmes/enrolments')
      .set(ctx.authHeaders)
      .send({
        programmeId,
        firstName: 'Progress',
        lastName: 'Learner',
        email: `ai-progress-${label}-${suffix}@example.com`,
      })
      .expect(201);

    return {
      ctx,
      enrolmentId: (enrolRes.body as { data: { enrolmentId: string } }).data
        .enrolmentId,
      moduleSlugs: AI_PROGRAMME_CATALOGUE_SEED.programmes[0].modules.map(
        (m) => m.slug,
      ),
    };
  }

  it('records module progress and completes programme', async () => {
    const { ctx, enrolmentId, moduleSlugs } = await enrolAiLearner('progress');

    for (const slug of moduleSlugs) {
      await request(app.getHttpServer())
        .post(`/api/v1/ai-programmes/enrolments/${enrolmentId}/progress`)
        .set(ctx.authHeaders)
        .send({ moduleSlug: slug, status: 'completed' })
        .expect(201);
    }

    const progressRes = await request(app.getHttpServer())
      .get(`/api/v1/ai-programmes/enrolments/${enrolmentId}/progress`)
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(progressRes.body);
    expect(progressRes.body.data.percentComplete).toBe(100);

    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/ai-programmes/enrolments/${enrolmentId}/complete`)
      .set(ctx.authHeaders)
      .expect(201);

    expectSuccessEnvelope(completeRes.body);
    expect(completeRes.body.data.enrolmentStatus).toBe('completed');
    expect(completeRes.body.data.summary).toEqual(
      expect.objectContaining({ moduleCount: moduleSlugs.length }),
    );
  });

  it('complete is idempotent when already completed', async () => {
    const { ctx, enrolmentId, moduleSlugs } = await enrolAiLearner(
      'complete-idempotent',
    );

    for (const slug of moduleSlugs) {
      await request(app.getHttpServer())
        .post(`/api/v1/ai-programmes/enrolments/${enrolmentId}/progress`)
        .set(ctx.authHeaders)
        .send({ moduleSlug: slug, status: 'completed' })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/ai-programmes/enrolments/${enrolmentId}/complete`)
      .set(ctx.authHeaders)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/ai-programmes/enrolments/${enrolmentId}/complete`)
      .set(ctx.authHeaders)
      .expect(201);

    expectSuccessEnvelope(second.body);
    expect(second.body.data.enrolmentStatus).toBe('completed');
  });
});
