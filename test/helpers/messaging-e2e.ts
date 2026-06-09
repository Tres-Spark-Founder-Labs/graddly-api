import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';

import { createVerifiedUser, type IVerifiedUserFixture } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { expectSuccessEnvelope } from './e2e-response-contracts.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export interface IMessagingContext {
  owner: IVerifiedUserFixture;
  orgId: string;
  authHeaders: Record<string, string>;
  apprenticeId: string;
  enrolmentId: string;
  apprenticeUserId: string;
  tutorUserId: string;
  managerUserId: string;
}

export async function createMessagingContext(
  app: INestApplication<App>,
  label: string,
): Promise<IMessagingContext> {
  const suffix = Date.now();
  const owner = await createVerifiedUser(app, {
    email: `msg-owner-${label}-${suffix}@example.com`,
  });

  const orgRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(buildOrgPayload(`Messaging Org ${label} ${suffix}`))
    .expect(201);
  const orgId = (orgRes.body as { data: { id: string } }).data.id;

  const authHeaders: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: orgId,
  };
  authHeaders['Authorization'] = `Bearer ${owner.accessToken}`;

  const programmeRes = await request(app.getHttpServer())
    .post('/api/v1/programmes')
    .set(authHeaders)
    .send({
      code: `MSG-PROG-${suffix}`,
      title: 'Messaging Programme',
      status: 'active',
    })
    .expect(201);
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await request(app.getHttpServer())
    .post('/api/v1/standards')
    .set(authHeaders)
    .send({
      programmeId,
      code: `MSG-STD-${suffix}`,
      title: 'Messaging Standard',
      status: 'active',
    })
    .expect(201);
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const apprenticeRes = await request(app.getHttpServer())
    .post('/api/v1/apprentices')
    .set(authHeaders)
    .send({
      firstName: 'Msg',
      lastName: 'Apprentice',
      email: `msg-apprentice-${suffix}@example.com`,
    })
    .expect(201);
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

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
    .send({
      apprenticeUserId: owner.userId,
      tutorUserId: owner.userId,
      employerManagerUserId: owner.userId,
    })
    .expect(200);

  return {
    owner,
    orgId,
    authHeaders,
    apprenticeId,
    enrolmentId,
    apprenticeUserId: owner.userId,
    tutorUserId: owner.userId,
    managerUserId: owner.userId,
  };
}

export async function listThreads(
  app: INestApplication<App>,
  authHeaders: Record<string, string>,
  enrolmentId: string,
): Promise<
  Array<{ id: string; counterpartyParty: string; unreadCount: number }>
> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/messaging/threads?enrolmentId=${enrolmentId}`)
    .set(authHeaders)
    .expect(200);
  expectSuccessEnvelope(res.body);
  return (
    res.body as {
      data: Array<{
        id: string;
        counterpartyParty: string;
        unreadCount: number;
      }>;
    }
  ).data;
}

export function authHeadersForUser(
  accessToken: string,
  orgId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: orgId,
  };
  headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}
