import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from '../helpers/reporting-e2e.js';

import type { App } from 'supertest/types';

describe('Learner profile (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns aggregated learner profile for provider', async () => {
    const ctx = await createProviderDirectoryContext(app, 'profile');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/learners/${ctx.enrolmentId}/profile`)
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(res.body);
    const profile = (
      res.body as {
        data: {
          enrolmentId: string;
          personal: { email: string };
          programme: { standardTitle: string };
          employer: { organisationName: string | null };
          messageThreadIds: string[];
        };
      }
    ).data;

    expect(profile.enrolmentId).toBe(ctx.enrolmentId);
    expect(profile.personal.email).toContain('@example.com');
    expect(profile.programme.standardTitle).toBeTruthy();
    expect(profile.employer.organisationName).toBeTruthy();
    expect(Array.isArray(profile.messageThreadIds)).toBe(true);
  });
});
