import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { LevyEligibilityStatus } from '../../src/levy-exchange/enums/levy-eligibility-status.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

describe('Levy eligibility (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /levy-exchange/eligibility/check without auth returns PRD-shaped body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/eligibility/check')
      .send({
        employeeCountBand: '10_49',
        sector: 'construction',
        region: 'north_west',
        hasDasAccount: false,
      })
      .expect(201);

    expectSuccessEnvelope(res.body);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        status: LevyEligibilityStatus.ELIGIBLE,
        estimatedFundingBand: expect.objectContaining({
          min: expect.any(Number),
          max: expect.any(Number),
          currency: 'GBP',
        }),
        nextSteps: expect.arrayContaining([expect.any(String)]),
        beginRegistrationPath: '/api/v1/flowportal-registration/sessions',
      }),
    );
  });

  it('returns check_with_advisor when DAS account flag is set', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/eligibility/check')
      .send({
        employeeCountBand: '10_49',
        sector: 'construction',
        region: 'north_west',
        hasDasAccount: true,
      })
      .expect(201);

    expect(res.body.data.status).toBe(LevyEligibilityStatus.CHECK_WITH_ADVISOR);
    expect(res.body.data.beginRegistrationPath).toBeUndefined();
  });
});
