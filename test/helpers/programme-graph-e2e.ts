import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';

import { createVerifiedUser, type IVerifiedUserFixture } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { findInvitationAcceptTokenForInvitationId } from './invitation-accept-redis.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export interface IProgrammeGraphIds {
  programmeId: string;
  standardId: string;
  apprenticeId: string;
}

export interface IOrgOwnerContext {
  owner: IVerifiedUserFixture;
  orgId: string;
  authHeaders: Record<string, string>;
}

export function authHeadersFor(
  accessToken: string,
  organisationId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: organisationId,
  };
  headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}

export async function createOrgOwnerContext(
  app: INestApplication<App>,
  orgNamePrefix: string,
): Promise<IOrgOwnerContext> {
  const suffix = Date.now();
  const owner = await createVerifiedUser(app, {
    email: `pg-owner-${suffix}@example.com`,
  });

  const orgRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(buildOrgPayload(`${orgNamePrefix} ${suffix}`))
    .expect(201);

  const orgId = (orgRes.body as { data: { id: string } }).data.id;
  return {
    owner,
    orgId,
    authHeaders: authHeadersFor(owner.accessToken, orgId),
  };
}

export async function seedProgrammeGraph(
  app: INestApplication<App>,
  authHeaders: Record<string, string>,
  options: {
    suffix?: number;
    programmeCode?: string;
    standardCode?: string;
    apprenticeEmail?: string;
  } = {},
): Promise<IProgrammeGraphIds> {
  const suffix = options.suffix ?? Date.now();
  const programmeCode = options.programmeCode ?? `PROG-${suffix}`;
  const standardCode = options.standardCode ?? `STD-${suffix}`;
  const apprenticeEmail =
    options.apprenticeEmail ?? `apprentice-${suffix}@example.com`;

  const programmeRes = await request(app.getHttpServer())
    .post('/api/v1/programmes')
    .set(authHeaders)
    .send({
      code: programmeCode,
      title: 'Test Programme',
      status: 'active',
    })
    .expect(201);
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await request(app.getHttpServer())
    .post('/api/v1/standards')
    .set(authHeaders)
    .send({
      programmeId,
      code: standardCode,
      title: 'Test Standard',
      status: 'active',
    })
    .expect(201);
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const apprenticeRes = await request(app.getHttpServer())
    .post('/api/v1/apprentices')
    .set(authHeaders)
    .send({
      firstName: 'Test',
      lastName: 'Apprentice',
      email: apprenticeEmail,
    })
    .expect(201);
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

  return { programmeId, standardId, apprenticeId };
}

export async function createEnrolment(
  app: INestApplication<App>,
  authHeaders: Record<string, string>,
  apprenticeId: string,
  standardId: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set(authHeaders)
    .send({ apprenticeId, standardId })
    .expect(201);
  return (res.body as { data: { id: string } }).data.id;
}

/** Invites an existing verified user into the org and accepts as that user. */
export async function addVerifiedUserToOrganisation(
  app: INestApplication<App>,
  authHeaders: Record<string, string>,
  user: IVerifiedUserFixture,
): Promise<void> {
  const createRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set(authHeaders)
    .send({ email: user.email, role: 'member' })
    .expect(201);
  const invitationId = (createRes.body as { data: { id: string } }).data.id;
  const acceptToken =
    await findInvitationAcceptTokenForInvitationId(invitationId);
  if (!acceptToken) {
    throw new Error('Invitation accept token not found in Redis');
  }
  await request(app.getHttpServer())
    .post('/api/v1/invitations/accept')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ token: acceptToken })
    .expect(200);
}
