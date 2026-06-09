import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import { expectMatchSearchResponse } from '../helpers/levy-exchange-contracts.js';
import {
  createLexOrgContext,
  seedDonorLink,
  seedLinkedDonor,
  seedRecipientProfile,
  seedTransferPreferences,
} from '../helpers/levy-exchange-e2e.js';

import type { App } from 'supertest/types';

describe('Levy Exchange matching (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 when recipient profile is missing', async () => {
    const ctx = await createLexOrgContext(app, 'matching-no-profile');
    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/matches/search')
      .set(ctx.authHeaders)
      .send({})
      .expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: 'Recipient profile not found',
      path: '/api/v1/levy-exchange/matches/search',
      error: 'Not Found',
    });
  });

  it('adds recipient to waiting pool when no donors match', async () => {
    const recipientCtx = await createLexOrgContext(app, 'matching-waiting');
    const suffix = Date.now();
    await seedRecipientProfile(app, recipientCtx, {
      sector: `isolated-sector-${suffix}`,
      region: `isolated-region-${suffix}`,
      employeeCountBand: `isolated-band-${suffix}`,
      programmeType: `isolated-programme-${suffix}`,
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/matches/search')
      .set(recipientCtx.authHeaders)
      .send({})
      .expect(201);

    expectSuccessEnvelope(res.body);
    expectMatchSearchResponse((res.body as { data: unknown }).data);
    expect((res.body as { data: { matches: unknown[] } }).data.matches).toEqual(
      [],
    );
    expect(
      (res.body as { data: { addedToWaitingPool: boolean } }).data
        .addedToWaitingPool,
    ).toBe(true);
  });

  it('returns ranked donor matches when donor surplus and preferences align', async () => {
    const donorCtx = await createLexOrgContext(app, 'matching-donor');
    const recipientCtx = await createLexOrgContext(app, 'matching-recipient');

    const { linkId } = await seedDonorLink(app, donorCtx);
    await seedLinkedDonor(app, donorCtx, linkId);
    await seedTransferPreferences(app, donorCtx);
    await seedRecipientProfile(app, recipientCtx);

    await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/surplus/recompute')
      .set(donorCtx.authHeaders)
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/matches/search')
      .set(recipientCtx.authHeaders)
      .send({ limit: 10 })
      .expect(201);

    expectSuccessEnvelope(res.body);
    const data = (
      res.body as {
        data: {
          matches: { donorOrganisationId: string }[];
          addedToWaitingPool: boolean;
        };
      }
    ).data;
    expect(data.matches.length).toBeGreaterThanOrEqual(1);
    expect(
      data.matches.some(
        (match) => match.donorOrganisationId === donorCtx.orgId,
      ),
    ).toBe(true);
    expect(data.addedToWaitingPool).toBe(false);
  });
});
