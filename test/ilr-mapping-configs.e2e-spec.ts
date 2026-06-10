import * as fs from 'fs';
import * as path from 'path';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import {
  ensurePublishedIlrMappingConfig,
  seedIlrOrgContext,
} from './helpers/ilr-seed.js';

import type { App } from 'supertest/types';

describe('ILR mapping configs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
    await ensurePublishedIlrMappingConfig();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists, creates, publishes, and retrieves active mapping configs', async () => {
    const suffix = Date.now();
    const { owner, orgId } = await seedIlrOrgContext(app, suffix);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/ilr/mapping-configs')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(listRes.body);
    const listed = (listRes.body as { data: { academicYear: string }[] }).data;
    expect(listed.some((row) => row.academicYear === '2025-26')).toBe(true);

    const activeRes = await request(app.getHttpServer())
      .get('/api/v1/ilr/mapping-configs/active')
      .query({ academicYear: '2025-26' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(activeRes.body);
    const activeConfig = (
      activeRes.body as { data: { version: number; config: object } }
    ).data;
    expect(activeConfig.version).toBe(1);

    const seedPath = path.resolve(
      __dirname,
      '../src/ilr/config/seeds/ilr-mapping-2025-26.v1.json',
    );
    const config = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as object;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/ilr/mapping-configs')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ academicYear: '2026-27', config })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const draftId = (
      createRes.body as { data: { id: string; version: number } }
    ).data.id;
    expect((createRes.body as { data: { version: number } }).data.version).toBe(
      1,
    );

    const publishRes = await request(app.getHttpServer())
      .post(`/api/v1/ilr/mapping-configs/${draftId}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    expectSuccessEnvelope(publishRes.body);
    expect(
      (publishRes.body as { data: { status: string; version: number } }).data
        .status,
    ).toBe('published');
    expect(
      (publishRes.body as { data: { version: number } }).data.version,
    ).toBe(1);

    const activeAfterPublish = await request(app.getHttpServer())
      .get('/api/v1/ilr/mapping-configs/active')
      .query({ academicYear: '2026-27' })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(200);

    expectSuccessEnvelope(activeAfterPublish.body);
    expect(
      (activeAfterPublish.body as { data: { version: number } }).data.version,
    ).toBe(1);
  });
});
