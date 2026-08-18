import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';

import { NotificationType } from '../src/notifications/enums/notification-type.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';

function createMigratorClient(): Client {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_MIGRATION_USERNAME || 'postgres',
    password: process.env.DB_MIGRATION_PASSWORD ?? '',
    database: process.env.DB_NAME || 'graddly_test',
  });
}

/**
 * `organisationId` became NOT NULL in migration 1781100000051 —
 * `app_create_notification` and the RLS policies are both keyed on it, so a
 * notification with no organisation is unreadable by anyone. The seed takes one
 * explicitly rather than relying on a nullable column that no longer exists.
 */
async function seedNotification(
  userId: string,
  organisationId: string,
  title: string,
): Promise<string> {
  const pg = createMigratorClient();
  await pg.connect();
  try {
    await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
    const result = await pg.query<{ id: string }>(
      `INSERT INTO notifications ("userId", "organisationId", type, title, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        organisationId,
        NotificationType.SYSTEM,
        title,
        'E2E notification body',
      ],
    );
    return result.rows[0].id;
  } finally {
    await pg.end();
  }
}

describe('NotificationsController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists and marks notifications as read', async () => {
    const suffix = Date.now();
    const user = await createVerifiedUser(app, {
      email: `notif-${suffix}@example.com`,
    });

    // The reader must have an organisation: `listForUser` filters by the
    // active one, so a notification outside it would be invisible.
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(buildOrgPayload(`Notif E2E Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const notificationId = await seedNotification(
      user.userId,
      orgId,
      `E2E notice ${suffix}`,
    );

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/notifications?page=1&perPage=10')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expectPaginatedListEnvelope(listRes.body);
    const items = (listRes.body as { data: { id: string; title: string }[] })
      .data;
    expect(items.some((item) => item.id === notificationId)).toBe(true);

    const readRes = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expectSuccessEnvelope(readRes.body);
    expect(
      (readRes.body as { data: { readAt: string | null } }).data.readAt,
    ).toEqual(expect.any(String));

    const unreadRes = await request(app.getHttpServer())
      .get('/api/v1/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expectPaginatedListEnvelope(unreadRes.body);
    const unreadIds = (unreadRes.body as { data: { id: string }[] }).data.map(
      (item) => item.id,
    );
    expect(unreadIds).not.toContain(notificationId);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({})
      .expect(200);
  });
});
