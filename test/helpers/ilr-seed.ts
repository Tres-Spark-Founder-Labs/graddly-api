import { createHash, randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';

import { createVerifiedUser } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';

export type IlrSeedContext = {
  owner: Awaited<ReturnType<typeof createVerifiedUser>>;
  orgId: string;
  enrolmentId: string;
  apprenticeId: string;
  standardId: string;
  ukprn: string;
};

function resolveRunId(suffix?: string | number): string {
  if (suffix !== undefined) {
    return String(suffix);
  }
  return randomUUID();
}

function deriveUkprn(runId: string): string {
  const hash = createHash('sha256').update(runId).digest();
  const offset = hash.readUInt32BE(0) % 90_000_000;
  return String(10_000_000 + offset).padStart(8, '0');
}

export async function seedIlrOrgContext(
  app: INestApplication<App>,
  suffix?: string | number,
  options: {
    ukprn?: string;
    invalidDates?: boolean;
  } = {},
): Promise<IlrSeedContext> {
  const runId = resolveRunId(suffix);
  const ukprn = options.ukprn ?? deriveUkprn(runId);

  const owner = await createVerifiedUser(app, {
    email: `ilr-owner-${runId}@example.com`,
  });

  const orgRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send(buildOrgPayload(`ILR Org ${runId}`, ukprn))
    .expect(201);
  const orgId = (orgRes.body as { data: { id: string } }).data.id;

  const programmeRes = await request(app.getHttpServer())
    .post('/api/v1/programmes')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .set(ORGANISATION_ID_HEADER, orgId)
    .send({
      code: `ILR-PROG-${runId}`,
      title: 'ILR Programme',
      status: 'active',
    })
    .expect(201);
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await request(app.getHttpServer())
    .post('/api/v1/standards')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .set(ORGANISATION_ID_HEADER, orgId)
    .send({
      programmeId,
      code: `ILR-STD-${runId}`,
      title: 'ILR Standard',
      status: 'active',
    })
    .expect(201);
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const apprenticeRes = await request(app.getHttpServer())
    .post('/api/v1/apprentices')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .set(ORGANISATION_ID_HEADER, orgId)
    .send({
      firstName: 'Ilr',
      lastName: 'Learner',
      email: `ilr-apprentice-${runId}@example.com`,
    })
    .expect(201);
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

  const enrolmentRes = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .set(ORGANISATION_ID_HEADER, orgId)
    .send({
      apprenticeId,
      standardId,
      plannedStartDate: options.invalidDates ? '2027-01-15' : '2025-01-15',
      plannedEndDate: options.invalidDates ? '2026-12-31' : '2026-12-31',
    })
    .expect(201);
  const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

  const activateRes = await request(app.getHttpServer())
    .post(`/api/v1/enrolments/${enrolmentId}/activate`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .set(ORGANISATION_ID_HEADER, orgId);

  if (activateRes.status !== 201) {
    throw new Error(
      `Expected enrolment activate 201, got ${activateRes.status}: ${JSON.stringify(activateRes.body)} (enrolmentId=${enrolmentId}, orgId=${orgId})`,
    );
  }

  return {
    owner,
    orgId,
    enrolmentId,
    apprenticeId,
    standardId,
    ukprn,
  };
}
