import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { expectPresignedUploadResource } from '../helpers/messaging-contracts.js';
import { createMessagingContext } from '../helpers/messaging-e2e.js';

import type { App } from 'supertest/types';

describe('Messaging attachments (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates presigned upload URL and rejects oversize attachments', async () => {
    const ctx = await createMessagingContext(app, 'attachments');

    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/messaging/attachments/upload-url')
      .set(ctx.authHeaders)
      .send({
        apprenticeId: ctx.apprenticeId,
        enrolmentId: ctx.enrolmentId,
        filename: 'notes.pdf',
        contentType: 'application/pdf',
        contentLength: 1024,
      })
      .expect(201);
    expectSuccessEnvelope(uploadRes.body);
    expectPresignedUploadResource(uploadRes.body.data);
    expect((uploadRes.body as { data: { key: string } }).data.key).toContain(
      `/learners/${ctx.apprenticeId}/attachment/`,
    );

    await request(app.getHttpServer())
      .post('/api/v1/messaging/attachments/upload-url')
      .set(ctx.authHeaders)
      .send({
        apprenticeId: ctx.apprenticeId,
        enrolmentId: ctx.enrolmentId,
        filename: 'huge.pdf',
        contentType: 'application/pdf',
        contentLength: 11 * 1024 * 1024,
      })
      .expect(422);

    await request(app.getHttpServer())
      .post('/api/v1/messaging/attachments/upload-url')
      .set(ctx.authHeaders)
      .send({
        apprenticeId: ctx.apprenticeId,
        enrolmentId: ctx.enrolmentId,
        filename: 'bad.exe',
        contentType: 'application/x-msdownload',
        contentLength: 100,
      })
      .expect(400);
  });
});
