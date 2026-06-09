import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AuditAction } from '../../src/audit/enums/audit-action.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import { expectMessageResource } from '../helpers/messaging-contracts.js';
import {
  createMessagingContext,
  listThreads,
} from '../helpers/messaging-e2e.js';

import type { App } from 'supertest/types';

describe('Messaging messages (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends messages, lists history, rejects archived thread writes, and audits create', async () => {
    const ctx = await createMessagingContext(app, 'messages');
    const threads = await listThreads(app, ctx.authHeaders, ctx.enrolmentId);
    const tutorThread = threads.find((t) => t.counterpartyParty === 'tutor')!;

    const sendRes = await request(app.getHttpServer())
      .post(`/api/v1/messaging/threads/${tutorThread.id}/messages`)
      .set(ctx.authHeaders)
      .send({ body: 'Hello tutor 👋' })
      .expect(201);
    expectSuccessEnvelope(sendRes.body);
    expectMessageResource(sendRes.body.data);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/messaging/threads/${tutorThread.id}/messages`)
      .set(ctx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(listRes.body);
    expect(listRes.body.data).toHaveLength(1);
    expectMessageResource(listRes.body.data[0]);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${ctx.enrolmentId}/complete`)
      .set(ctx.authHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/messaging/threads/${tutorThread.id}/messages`)
      .set(ctx.authHeaders)
      .send({ body: 'Should fail' })
      .expect(400);

    const auditRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .set(ctx.authHeaders)
      .query({ entityType: 'messages', action: AuditAction.INSERT })
      .expect(200);
    expectPaginatedListEnvelope(auditRes.body);
    expect(
      (auditRes.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);
  });
});
