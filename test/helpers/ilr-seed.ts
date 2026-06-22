import * as fs from 'fs';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'path';

import { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';

import { createVerifiedUser } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { createE2ePgClient } from './rls-db.js';

import type { App } from 'supertest/types';

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
    return `${String(suffix)}-${randomUUID().slice(0, 8)}`;
  }
  return randomUUID();
}

const RETRYABLE_HTTP_STATUSES = new Set([404, 408, 429, 500, 502, 503]);

async function postUntilCreated(
  execute: () => request.Test,
  label: string,
): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    last = await execute();
    if (last.status === 201) {
      return last;
    }
    if (RETRYABLE_HTTP_STATUSES.has(last.status) && attempt < 4) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250 * (attempt + 1));
      });
      continue;
    }
    break;
  }
  throw new Error(
    `Expected 201 for ${label}, got ${last?.status}: ${JSON.stringify(last?.body)}`,
  );
}

function deriveUkprn(runId: string): string {
  const hash = createHash('sha256').update(runId).digest();
  const offset = hash.readUInt32BE(0) % 90_000_000;
  return String(10_000_000 + offset).padStart(8, '0');
}

export async function ensurePublishedIlrMappingConfig(
  academicYear = '2025-26',
): Promise<void> {
  const pg = createE2ePgClient();
  await pg.connect();
  try {
    await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
    const existing = await pg.query<{ id: string }>(
      `SELECT id FROM ilr_mapping_configs
       WHERE "academicYear" = $1 AND status = 'published' AND "isDeleted" = false
       LIMIT 1`,
      [academicYear],
    );
    if (existing.rowCount) {
      return;
    }

    const seedPath = path.resolve(
      __dirname,
      '../../src/ilr/config/seeds/ilr-mapping-2025-26.v1.json',
    );
    const config = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as object;
    await pg.query(
      `INSERT INTO ilr_mapping_configs ("academicYear", version, status, config, "publishedAt")
       VALUES ($1, 1, 'published', $2::jsonb, now())`,
      [academicYear, JSON.stringify(config)],
    );
  } finally {
    await pg.end();
  }
}

export async function seedIlrOrgContext(
  app: INestApplication<App>,
  suffix?: string | number,
  options: {
    ukprn?: string;
    invalidDates?: boolean;
  } = {},
): Promise<IlrSeedContext> {
  await ensurePublishedIlrMappingConfig();

  const runId = resolveRunId(suffix);
  const ukprn = options.ukprn ?? deriveUkprn(runId);

  const owner = await createVerifiedUser(app, {
    email: `ilr-owner-${runId}@example.com`,
  });

  const orgRes = await postUntilCreated(
    () =>
      request(app.getHttpServer())
        .post('/api/v1/organisations')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(buildOrgPayload(`ILR Org ${runId}`, ukprn)),
    'organisation',
  );
  const orgId = (orgRes.body as { data: { id: string } }).data.id;

  const programmeRes = await postUntilCreated(
    () =>
      request(app.getHttpServer())
        .post('/api/v1/programmes')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          code: `ILR-PROG-${runId}`,
          title: 'ILR Programme',
          status: 'active',
        }),
    'programme',
  );
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await postUntilCreated(
    () =>
      request(app.getHttpServer())
        .post('/api/v1/standards')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          programmeId,
          code: `ILR-STD-${runId}`,
          title: 'ILR Standard',
          status: 'active',
        }),
    'standard',
  );
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const apprenticeRes = await postUntilCreated(
    () =>
      request(app.getHttpServer())
        .post('/api/v1/apprentices')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          firstName: 'Ilr',
          lastName: 'Learner',
          email: `ilr-apprentice-${runId}@example.com`,
        }),
    'apprentice',
  );
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

  const enrolmentRes = await postUntilCreated(
    () =>
      request(app.getHttpServer())
        .post('/api/v1/enrolments')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set(ORGANISATION_ID_HEADER, orgId)
        .send({
          apprenticeId,
          standardId,
          plannedStartDate: options.invalidDates ? '2027-01-15' : '2025-01-15',
          plannedEndDate: options.invalidDates ? '2026-12-31' : '2026-12-31',
        }),
    'enrolment',
  );
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
