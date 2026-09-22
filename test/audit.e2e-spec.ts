import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

import { createVerifiedUser, loginVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectFilteredHttpExceptionBody,
  expectPaginatedListEnvelope,
} from './helpers/e2e-response-contracts.js';
import { findInvitationAcceptTokenForInvitationId } from './helpers/invitation-accept-redis.js';
import { createE2ePgClient } from './helpers/rls-db.js';

describe('AuditController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('records invitation insert and exports JSON for owner; member forbidden; CSV raw', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `audit-owner-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Audit Org ${suffix}`))
      .expect(201);

    const organisationId = (orgRes.body as { data: { id: string } }).data.id;

    const { accessToken: ownerToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );

    const invitee = await createVerifiedUser(app, {
      email: `audit-invitee-${suffix}@example.com`,
    });

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: invitee.email, role: 'member' })
      .expect(201);

    const invitationId = (createRes.body as { data: { id: string } }).data.id;
    const acceptToken =
      await findInvitationAcceptTokenForInvitationId(invitationId);
    expect(acceptToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${invitee.accessToken}`)
      .send({ token: acceptToken })
      .expect(200);

    const exportRes = await request(app.getHttpServer())
      .get(
        '/api/v1/audit/export?page=1&perPage=20&entityType=invitations&action=insert',
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expectPaginatedListEnvelope(exportRes.body);
    const items = (
      exportRes.body as {
        data: {
          entityType: string;
          action: string;
          organisationId: string;
        }[];
      }
    ).data;

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((item) => item.entityType === 'invitations')).toBe(true);
    expect(items.some((item) => item.action === 'insert')).toBe(true);
    expect(items.every((item) => item.organisationId === organisationId)).toBe(
      true,
    );

    const { accessToken: memberToken } = await loginVerifiedUser(
      app,
      invitee.email,
      invitee.password,
    );

    const forbiddenExport = await request(app.getHttpServer())
      .get('/api/v1/audit/export?page=1&perPage=10')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    expectFilteredHttpExceptionBody(
      forbiddenExport.body as Record<string, unknown>,
      {
        statusCode: 403,
        message: 'Insufficient permissions',
        path: /^\/api\/v1\/audit\/export/,
        error: 'Forbidden',
      },
    );

    const csvRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export?format=csv&page=1&perPage=10')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(String(csvRes.text)).toContain('entityType');
    expect(String(csvRes.text)).toContain('invitations');
  });

  /**
   * The complete export. The provider's panel used to save the paginated
   * endpoint's default twenty rows as the audit log; this reads every entry
   * in scope, honours the date range, and refuses rather than truncates when
   * the scope is over the limit.
   */
  it('exports every entry in range, and refuses with 413 rather than truncating when the scope is too large', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `audit-complete-${suffix}@example.com`,
    });
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Audit Complete Org ${suffix}`))
      .expect(201);
    const organisationId = (orgRes.body as { data: { id: string } }).data.id;
    const { accessToken } = await loginVerifiedUser(
      app,
      owner.email,
      owner.password,
    );
    const auth = { ['Authorization']: `Bearer ${accessToken}` };

    /**
     * 1,001 entries in 2020, one an hour from 01:00 on 1 January, written as
     * the migration role (seeding, not what is under test). The limit is
     * lowered to its floor of 1,000 for this test only, so the whole scope
     * is one over it.
     */
    const LIMIT = 1000;
    const sudo = createE2ePgClient();
    await sudo.connect();
    try {
      await sudo.query(
        `INSERT INTO audit_log_entries
           ("organisationId", "entityType", "entityId", action, changes, "createdAt")
         SELECT $1, 'seeded', gen_random_uuid(), 'insert', '{}'::jsonb,
                TIMESTAMPTZ '2020-01-01T00:00:00Z' + (i || ' hours')::interval
           FROM generate_series(1, $2::int) AS i`,
        [organisationId, LIMIT + 1],
      );
    } finally {
      await sudo.end();
    }
    const config = app.get(ConfigService);
    const get = config.get.bind(config);
    const spy = jest
      .spyOn(config, 'get')
      .mockImplementation(((key: string, fallback?: unknown) =>
        key === 'app.audit.exportMaxRows'
          ? LIMIT
          : get(key, fallback)) as typeof config.get);

    try {
      const tooLarge = await request(app.getHttpServer())
        .get('/api/v1/audit/export/all')
        .query({ entityType: 'seeded' })
        .set(auth)
        .expect(413);
      expect((tooLarge.body as { message: string }).message).toContain('1,001');

      // To 23:59:59.999 on 20 January: hours 1..479.
      const inRange = await request(app.getHttpServer())
        .get('/api/v1/audit/export/all')
        .query({
          entityType: 'seeded',
          from: '2020-01-01T00:00:00.000Z',
          to: '2020-01-20T23:59:59.999Z',
        })
        .set(auth)
        .expect(200);
      const body = (
        inRange.body as {
          data: {
            organisationId: string;
            total: number;
            filters: { from: string | null; to: string | null };
            entries: { id: string; createdAt: string }[];
          };
        }
      ).data;
      expect(body.total).toBe(479);
      expect(body.entries).toHaveLength(479);
      expect(new Set(body.entries.map((e) => e.id)).size).toBe(479);
      expect(inRange.headers['x-total-count']).toBe('479');
      expect(body.organisationId).toBe(organisationId);
      expect(body.filters.from).toBe('2020-01-01T00:00:00.000Z');
      expect(body.entries[0].createdAt).toBe('2020-01-20T23:00:00.000Z');
      expect(body.entries[478].createdAt).toBe('2020-01-01T01:00:00.000Z');

      const csv = await request(app.getHttpServer())
        .get('/api/v1/audit/export/all')
        .query({
          format: 'csv',
          entityType: 'seeded',
          to: '2020-01-20T23:59:59.999Z',
        })
        .set(auth)
        .expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      // Header line plus one line per entry.
      expect(String(csv.text).trim().split('\n')).toHaveLength(480);
    } finally {
      spy.mockRestore();
    }
  });
});
