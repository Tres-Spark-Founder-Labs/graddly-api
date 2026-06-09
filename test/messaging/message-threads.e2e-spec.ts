import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { createVerifiedUser } from '../helpers/e2e-http.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { expectMessageThreadResource } from '../helpers/messaging-contracts.js';
import {
  authHeadersForUser,
  createMessagingContext,
  listThreads,
} from '../helpers/messaging-e2e.js';

import type { App } from 'supertest/types';

describe('Messaging threads (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists threads, returns unread count, marks read, and blocks strangers', async () => {
    const ctx = await createMessagingContext(app, 'threads');

    const threads = await listThreads(app, ctx.authHeaders, ctx.enrolmentId);
    expect(threads.length).toBe(2);
    threads.forEach((thread) => expectMessageThreadResource(thread));

    const tutorThread = threads.find((t) => t.counterpartyParty === 'tutor');
    expect(tutorThread).toBeDefined();

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/messaging/threads/${tutorThread!.id}`)
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(detailRes.body);
    expectMessageThreadResource(detailRes.body.data);

    const unreadRes = await request(app.getHttpServer())
      .get('/api/v1/messaging/threads/unread-count')
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(unreadRes.body);
    expect(unreadRes.body.data).toEqual(
      expect.objectContaining({ unreadCount: expect.any(Number) }),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/messaging/threads/${tutorThread!.id}/read`)
      .set(ctx.authHeaders)
      .expect(200);

    const stranger = await createVerifiedUser(app, {
      email: `msg-stranger-${Date.now()}@example.com`,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/messaging/threads/${tutorThread!.id}`)
      .set(authHeadersForUser(stranger.accessToken, ctx.orgId))
      .expect(403);
  });
});
