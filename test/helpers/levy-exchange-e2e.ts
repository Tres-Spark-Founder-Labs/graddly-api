import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../src/common/context/correlation-id-context.js';
import { DasHttpClient } from '../../src/das/das-http.client.js';
import {
  setLastKnownOrganisationIdForGuc,
  setLastKnownUserIdForGuc,
} from '../../src/database/apply-tenant-gucs.js';
import { DasDonorLink } from '../../src/levy-exchange/entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from '../../src/levy-exchange/entities/das-donor-oauth-token.entity.js';
import { DasLevyTranche } from '../../src/levy-exchange/entities/das-levy-tranche.entity.js';
import { DasDonorLinkStatus } from '../../src/levy-exchange/enums/das-donor-link-status.enum.js';
import { LevyMatchApplicationStatus } from '../../src/levy-exchange/enums/levy-match-application-status.enum.js';
import { TokenEncryptionService } from '../../src/levy-exchange/services/token-encryption.service.js';

import { createVerifiedUser, type IVerifiedUserFixture } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { expectSuccessEnvelope } from './e2e-response-contracts.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { Repository } from 'typeorm';

function ensureLevyExchangeE2eEnv(): void {
  process.env.DAS_DONOR_OAUTH_AUTHORIZE_URL ??=
    'https://das.example.com/oauth/authorize';
  process.env.DAS_DONOR_OAUTH_TOKEN_URL ??=
    'https://das.example.com/oauth/token';
  process.env.DAS_DONOR_OAUTH_CLIENT_ID ??= 'e2e-donor-client-id';
  process.env.DAS_DONOR_OAUTH_CLIENT_SECRET ??= 'e2e-donor-client-secret';
  process.env.DAS_DONOR_OAUTH_REDIRECT_URI ??=
    'http://localhost:3000/api/v1/levy-exchange/donor-links/oauth/callback';
  process.env.DAS_DONOR_OAUTH_SCOPE ??= 'levy.read';
}

ensureLevyExchangeE2eEnv();

export interface ILexOrgContext {
  user: IVerifiedUserFixture;
  orgId: string;
  accessToken: string;
  authHeaders: Record<string, string>;
}

export interface ISeedDonorLinkResult {
  linkId: string;
  body: unknown;
}

const DEFAULT_RECIPIENT_PROFILE = {
  sector: 'construction',
  region: 'north_west',
  employeeCountBand: '10_49',
  programmeType: 'standards',
  transferAmountRequired: '15000.00',
  hasDasAccount: true,
};

const DEFAULT_TRANSFER_PREFERENCES = {
  sectors: ['construction'],
  regions: ['north_west'],
  sizeBands: ['10_49'],
  programmeTypes: ['standards'],
  maxPerRecipient: '20000.00',
  openMatching: false,
  anonymousMatching: false,
};

export async function createLexOrgContext(
  app: INestApplication<App>,
  label: string,
): Promise<ILexOrgContext> {
  const suffix = Date.now();
  const user = await createVerifiedUser(app, {
    email: `lex-${label}-${suffix}@example.com`,
  });

  const orgRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send(buildOrgPayload(`Lex ${label} ${suffix}`))
    .expect(201);

  const orgId = (orgRes.body as { data: { id: string } }).data.id;

  const authHeaders: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: orgId,
  };
  authHeaders['Authorization'] = `Bearer ${user.accessToken}`;

  return {
    user,
    orgId,
    accessToken: user.accessToken,
    authHeaders,
  };
}

export async function seedDonorLink(
  app: INestApplication<App>,
  ctx: ILexOrgContext,
  opts: { label?: string; ukprn?: string } = {},
): Promise<ISeedDonorLinkResult> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/levy-exchange/donor-links')
    .set(ctx.authHeaders)
    .send({
      label: opts.label ?? 'HQ',
      ukprn: opts.ukprn ?? '12345678',
    })
    .expect(201);

  expectSuccessEnvelope(res.body);
  const linkId = (res.body as { data: { id: string } }).data.id;
  return { linkId, body: res.body };
}

export function applyTenantContext(ctx: ILexOrgContext): void {
  setCurrentOrganisationId(ctx.orgId);
  setCurrentUserId(ctx.user.userId);
  setLastKnownUserIdForGuc(ctx.user.userId);
  setLastKnownOrganisationIdForGuc(ctx.orgId);
}

export async function seedLinkedDonor(
  app: INestApplication<App>,
  ctx: ILexOrgContext,
  linkId: string,
): Promise<void> {
  applyTenantContext(ctx);

  const linkRepo = app.get<Repository<DasDonorLink>>(
    getRepositoryToken(DasDonorLink),
  );
  const tokenRepo = app.get<Repository<DasDonorOAuthToken>>(
    getRepositoryToken(DasDonorOAuthToken),
  );
  const trancheRepo = app.get<Repository<DasLevyTranche>>(
    getRepositoryToken(DasLevyTranche),
  );
  const encryption = app.get(TokenEncryptionService);

  await linkRepo.update(linkId, {
    status: DasDonorLinkStatus.LINKED,
    consentedAt: new Date(),
    lastBalance: '50000.00',
    lastSyncedAt: new Date(),
    dasAccountId: 'das-account-1',
    lastRawPayload: {
      tranches: [{ amount: 50000, expiresOn: '2028-06-01' }],
    },
  });

  await tokenRepo.save(
    tokenRepo.create({
      organisationId: ctx.orgId,
      donorLinkId: linkId,
      accessTokenEncrypted: encryption.encrypt('test-access-token'),
      refreshTokenEncrypted: encryption.encrypt('test-refresh-token'),
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'levy.read',
    }),
  );

  await trancheRepo.save(
    trancheRepo.create({
      organisationId: ctx.orgId,
      donorLinkId: linkId,
      amount: '50000.00',
      expiresOn: '2028-06-01',
      rawPayload: { amount: 50000, expiresOn: '2028-06-01' },
    }),
  );
}

export async function seedRecipientProfile(
  app: INestApplication<App>,
  ctx: ILexOrgContext,
  overrides: Partial<typeof DEFAULT_RECIPIENT_PROFILE> = {},
): Promise<void> {
  await request(app.getHttpServer())
    .put('/api/v1/levy-exchange/recipient-profile')
    .set(ctx.authHeaders)
    .send({ ...DEFAULT_RECIPIENT_PROFILE, ...overrides })
    .expect(200);
}

export async function seedTransferPreferences(
  app: INestApplication<App>,
  ctx: ILexOrgContext,
  overrides: Partial<typeof DEFAULT_TRANSFER_PREFERENCES> = {},
): Promise<void> {
  await request(app.getHttpServer())
    .put('/api/v1/levy-exchange/transfer-preferences')
    .set(ctx.authHeaders)
    .send({ ...DEFAULT_TRANSFER_PREFERENCES, ...overrides })
    .expect(200);
}

export async function seedConfirmedMatch(
  app: INestApplication<App>,
  donorCtx: ILexOrgContext,
  recipientCtx: ILexOrgContext,
): Promise<{ matchApplicationId: string }> {
  const { linkId } = await seedDonorLink(app, donorCtx);
  await seedLinkedDonor(app, donorCtx, linkId);
  await seedTransferPreferences(app, donorCtx);
  await seedRecipientProfile(app, recipientCtx);

  await request(app.getHttpServer())
    .post('/api/v1/levy-exchange/surplus/recompute')
    .set(donorCtx.authHeaders)
    .expect(201);

  const createRes = await request(app.getHttpServer())
    .post('/api/v1/levy-exchange/match-applications')
    .set(recipientCtx.authHeaders)
    .send({
      donorOrganisationId: donorCtx.orgId,
      requestedAmount: '15000.00',
    })
    .expect(201);

  const matchApplicationId = (createRes.body as { data: { id: string } }).data
    .id;

  await request(app.getHttpServer())
    .patch(`/api/v1/levy-exchange/match-applications/${matchApplicationId}`)
    .set(donorCtx.authHeaders)
    .send({ status: LevyMatchApplicationStatus.CONFIRMED })
    .expect(200);

  return { matchApplicationId };
}

export function mockDasForLevyExchange(app: INestApplication<App>): void {
  const client = app.get(DasHttpClient);
  jest.spyOn(client, 'fetchLevyBalance').mockResolvedValue({
    accountId: 'das-account-1',
    balance: '50000.00',
    currency: 'GBP',
    raw: {
      tranches: [{ amount: 50000, expiresOn: '2028-06-01' }],
    },
  });
  jest.spyOn(client, 'createLevyTransferConsent').mockResolvedValue({
    reference: 'ESFA-TRANSFER-REF-1',
    raw: { status: 'confirmed', reference: 'ESFA-TRANSFER-REF-1' },
  });
  jest.spyOn(client, 'fetchTransferStatus').mockResolvedValue({
    status: 'active',
    raw: { status: 'active' },
  });
}
