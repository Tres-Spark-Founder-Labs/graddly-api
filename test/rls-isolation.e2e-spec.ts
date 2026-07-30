import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/configure-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectOrganisationResource,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import { createAppDbClient, setTenantGucs } from './helpers/rls-db.js';
import {
  IRlsTenantFixture,
  signupLoginAndCreateOrg,
} from './helpers/rls-tenant.js';

describe('RLS tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let tenantA: IRlsTenantFixture;
  let tenantB: IRlsTenantFixture;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantA = await signupLoginAndCreateOrg(app, 'tenant-a');
    tenantB = await signupLoginAndCreateOrg(app, 'tenant-b');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('HTTP API', () => {
    it('prevents cross-tenant organisation list and read when RLS is enabled', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/organisations')
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(200);

      expectSuccessEnvelope(listRes.body);
      const ids = (listRes.body.data as { id: string }[]).map((o) => o.id);
      expect(ids).toContain(tenantA.organisationId);
      expect(ids).not.toContain(tenantB.organisationId);

      const getOtherRes = await request(app.getHttpServer())
        .get(`/api/v1/organisations/${tenantB.organisationId}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(404);

      expectFilteredHttpExceptionBody(
        getOtherRes.body as Record<string, unknown>,
        {
          statusCode: 404,
          message: 'Organisation not found',
          path: `/api/v1/organisations/${tenantB.organisationId}`,
          error: 'Not Found',
        },
      );
    });

    it('allows own-tenant organisation read', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/organisations/${tenantA.organisationId}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(200);

      expectSuccessEnvelope(res.body);
      expectOrganisationResource(res.body.data);
      expect((res.body.data as { id: string }).id).toBe(tenantA.organisationId);
    });

    // Cross-tenant writes are rejected at the service layer (403) before any DB
    // lookup, rather than falling through to RLS masking (404). Tenant A supplies
    // their OWN org via X-Organisation-Id so they hold a legitimate owner context —
    // this exercises the real cross-tenant check rather than merely tripping the
    // "no active organisation context" guard.
    it('prevents cross-tenant organisation update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/organisations/${tenantB.organisationId}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .set('X-Organisation-Id', tenantA.organisationId)
        .send({ name: 'Hijacked Trust' })
        .expect(403);

      expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
        statusCode: 403,
        message: 'You can only update your active organisation',
        path: `/api/v1/organisations/${tenantB.organisationId}`,
        error: 'Forbidden',
      });
    });

    it('prevents cross-tenant organisation delete', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/organisations/${tenantB.organisationId}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .set('X-Organisation-Id', tenantA.organisationId)
        .expect(403);

      expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
        statusCode: 403,
        message: 'You can only delete your active organisation',
        path: `/api/v1/organisations/${tenantB.organisationId}`,
        error: 'Forbidden',
      });
    });

    // Guards against information disclosure: a foreign-but-real org and a
    // nonexistent org must be indistinguishable, so 403 cannot be used to probe
    // which organisation ids exist.
    it('returns the same 403 for a nonexistent organisation id (no existence leak)', async () => {
      const nonexistentId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/organisations/${nonexistentId}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .set('X-Organisation-Id', tenantA.organisationId)
        .expect(403);

      expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
        statusCode: 403,
        message: 'You can only delete your active organisation',
        path: `/api/v1/organisations/${nonexistentId}`,
        error: 'Forbidden',
      });
    });
  });

  describe('RLS at database layer', () => {
    let db: Client;

    beforeAll(async () => {
      db = createAppDbClient();
      await db.connect();
    });

    afterAll(async () => {
      await db.end();
    });

    beforeEach(async () => {
      await setTenantGucs(db, tenantA.userId, tenantA.organisationId);
    });

    it('hides other tenant user rows from SELECT', async () => {
      const otherUser = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [tenantB.userId],
      );
      expect(otherUser.rows).toHaveLength(0);
    });

    it('allows own user row from SELECT', async () => {
      const ownUser = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [tenantA.userId],
      );
      expect(ownUser.rows).toHaveLength(1);
      expect(ownUser.rows[0]?.id).toBe(tenantA.userId);
    });

    it('hides other organisation memberships from SELECT', async () => {
      const otherMemberships = await db.query<{ userId: string }>(
        `SELECT "userId" FROM organisation_memberships WHERE "organisationId" = $1`,
        [tenantB.organisationId],
      );
      expect(otherMemberships.rows).toHaveLength(0);
    });

    it('allows own organisation memberships from SELECT', async () => {
      const ownMemberships = await db.query<{ userId: string }>(
        `SELECT "userId" FROM organisation_memberships WHERE "organisationId" = $1`,
        [tenantA.organisationId],
      );
      expect(ownMemberships.rows.length).toBeGreaterThanOrEqual(1);
      expect(
        ownMemberships.rows.some((row) => row.userId === tenantA.userId),
      ).toBe(true);
    });
  });
});
