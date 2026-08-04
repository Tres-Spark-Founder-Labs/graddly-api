import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

/**
 * F2.4.3 — employer satisfaction surveys.
 */
describe('Employer surveys (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const createTemplate = async (
    ctx: Awaited<ReturnType<typeof createProviderDirectoryContext>>,
  ) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/surveys/templates')
      .set(ctx.authHeaders)
      .send({
        name: 'Employer satisfaction',
        questions: [
          { type: 'likert', prompt: 'How is our communication?' },
          { type: 'nps', prompt: 'Would you recommend us?' },
          { type: 'text', prompt: 'Anything else?' },
        ],
      })
      .expect(201);

    return (res.body as { data: { id: string } }).data.id;
  };

  const createCampaign = async (
    ctx: Awaited<ReturnType<typeof createProviderDirectoryContext>>,
    templateId: string,
    closesAt = inAnHour(),
  ) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/surveys/campaigns')
      .set(ctx.authHeaders)
      .send({
        templateId,
        name: 'Q3 satisfaction',
        closesAt,
        recipients: [
          { contactEmail: 'hr@acme.example.com' },
          { contactEmail: 'ops@acme.example.com' },
        ],
      })
      .expect(201);

    return (
      res.body as {
        data: {
          campaign: { id: string; resultsAvailableAt: string };
          invitations: { contactEmail: string; token: string; url: string }[];
        };
      }
    ).data;
  };

  /** AC1 — "up to 10 questions". */
  it('rejects a template with more than ten questions', async () => {
    const ctx = await createProviderDirectoryContext(app, 'sv-limit');

    await request(app.getHttpServer())
      .post('/api/v1/surveys/templates')
      .set(ctx.authHeaders)
      .send({
        name: 'Too long',
        questions: Array.from({ length: 11 }, (_, i) => ({
          type: 'likert',
          prompt: `Question ${i + 1}`,
        })),
      })
      // 422, not 400: this project returns Unprocessable Entity for
      // class-validator failures and reserves 400 for errors the service
      // raises itself, such as an answer outside its scale below.
      .expect(422);
  });

  /**
   * AC2 — "no login required for employer to respond".
   *
   * The whole point of this test is that no auth headers are sent.
   */
  it('lets an employer open and answer a survey with no login', async () => {
    const ctx = await createProviderDirectoryContext(app, 'sv-public');
    const templateId = await createTemplate(ctx);
    const { invitations } = await createCampaign(ctx, templateId);
    const { token } = invitations[0];

    const open = await request(app.getHttpServer())
      .get(`/api/v1/public/surveys/${token}`)
      .expect(200);

    expectSuccessEnvelope(open.body);
    const survey = (
      open.body as {
        data: {
          campaignName: string;
          questions: unknown[];
          alreadyResponded: boolean;
        };
      }
    ).data;
    expect(survey.campaignName).toBe('Q3 satisfaction');
    expect(survey.questions).toHaveLength(3);
    expect(survey.alreadyResponded).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/v1/public/surveys/${token}/responses`)
      .send({ answers: { q1: 4, q2: 9, q3: 'Communication has been good.' } })
      .expect(201);

    const reopened = await request(app.getHttpServer())
      .get(`/api/v1/public/surveys/${token}`)
      .expect(200);
    expect(
      (reopened.body as { data: { alreadyResponded: boolean } }).data
        .alreadyResponded,
    ).toBe(true);
  });

  /**
   * The link is emailed and may be forwarded. A second holder must not be able
   * to silently replace the employer's answers.
   */
  it('accepts only one response per link', async () => {
    const ctx = await createProviderDirectoryContext(app, 'sv-once');
    const templateId = await createTemplate(ctx);
    const { invitations } = await createCampaign(ctx, templateId);
    const { token } = invitations[0];

    await request(app.getHttpServer())
      .post(`/api/v1/public/surveys/${token}/responses`)
      .send({ answers: { q1: 5 } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/public/surveys/${token}/responses`)
      .send({ answers: { q1: 1 } })
      .expect(400);
  });

  it('rejects an answer outside its scale', async () => {
    const ctx = await createProviderDirectoryContext(app, 'sv-scale');
    const templateId = await createTemplate(ctx);
    const { invitations } = await createCampaign(ctx, templateId);

    await request(app.getHttpServer())
      .post(`/api/v1/public/surveys/${invitations[0].token}/responses`)
      // Likert is 1–5.
      .send({ answers: { q1: 9 } })
      .expect(400);
  });

  it('does not reveal whether an unknown token ever existed', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/public/surveys/not-a-real-token')
      .expect(404);
  });

  /**
   * AC4 — "results are available 24 hours after survey closes".
   *
   * The counts are returned so a provider knows whether to chase; every score
   * is withheld. Returning scores alongside a "not available" flag would be a
   * lock with the key taped to it.
   */
  it('withholds scores until the embargo lifts, but reports response rate', async () => {
    const ctx = await createProviderDirectoryContext(app, 'sv-embargo');
    const templateId = await createTemplate(ctx);
    const { campaign, invitations } = await createCampaign(ctx, templateId);

    await request(app.getHttpServer())
      .post(`/api/v1/public/surveys/${invitations[0].token}/responses`)
      .send({ answers: { q1: 5, q2: 10, q3: 'Excellent support' } })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/surveys/campaigns/${campaign.id}/results`)
      .set(ctx.authHeaders)
      .expect(200);

    const results = (
      res.body as {
        data: {
          resultsAvailable: boolean;
          invitedCount: number;
          responseCount: number;
          responseRatePercent: number | null;
          npsScore: number | null;
          questions: unknown[];
          topTerms: unknown[];
        };
      }
    ).data;

    expect(results.resultsAvailable).toBe(false);
    // Knowing how many replied is not a result.
    expect(results.invitedCount).toBe(2);
    expect(results.responseCount).toBe(1);
    expect(results.responseRatePercent).toBe(50);
    // Nothing that could identify how anyone scored them.
    expect(results.npsScore).toBeNull();
    expect(results.questions).toEqual([]);
    expect(results.topTerms).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('Excellent support');
  });

  it('keeps surveys from leaking across providers', async () => {
    const mine = await createProviderDirectoryContext(app, 'sv-mine');
    const theirs = await createProviderDirectoryContext(app, 'sv-theirs');

    const templateId = await createTemplate(theirs);
    const { campaign } = await createCampaign(theirs, templateId);

    await request(app.getHttpServer())
      .get(`/api/v1/surveys/campaigns/${campaign.id}/results`)
      .set(mine.authHeaders)
      .expect(404);

    const templates = await request(app.getHttpServer())
      .get('/api/v1/surveys/templates')
      .set(mine.authHeaders)
      .expect(200);

    expect((templates.body as { data: unknown[] }).data).toHaveLength(0);
  });
});
