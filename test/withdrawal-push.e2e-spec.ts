import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import request from 'supertest';
import { Repository } from 'typeorm';

import { WithdrawalCompletionPush } from '../src/withdrawal-push/entities/withdrawal-completion-push.entity.js';
import { WithdrawalPushStatus } from '../src/withdrawal-push/enums/withdrawal-push-status.enum.js';
import { WITHDRAWAL_PUSH_JOB_SEND } from '../src/withdrawal-push/withdrawal-push.constants.js';
import { WithdrawalPushProcessor } from '../src/withdrawal-push/withdrawal-push.processor.js';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import {
  createOrgOwnerContext,
  createEnrolment,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { IWithdrawalPushJobPayload } from '../src/withdrawal-push/withdrawal-push.payload.js';
import type { App } from 'supertest/types';

async function processWithdrawalPushJobInApp(
  app: INestApplication<App>,
  payload: IWithdrawalPushJobPayload,
): Promise<void> {
  const processor = new WithdrawalPushProcessor(
    app.get(ConfigService),
    app.get<Repository<WithdrawalCompletionPush>>(
      getRepositoryToken(WithdrawalCompletionPush),
    ),
  );

  const job = {
    id: payload.pushId,
    name: WITHDRAWAL_PUSH_JOB_SEND,
    data: payload,
  } as Job<IWithdrawalPushJobPayload>;

  try {
    await processor.process(job);
  } catch {
    // Expected when endpoint is not configured in test env.
  }
}

describe('WithdrawalPushController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists failed pushes, retrieves one by id, and retries', async () => {
    const { authHeaders, orgId } = await createOrgOwnerContext(
      app,
      'Withdrawal Push Org',
    );
    const { standardId, apprenticeId } = await seedProgrammeGraph(
      app,
      authHeaders,
    );
    const enrolmentId = await createEnrolment(
      app,
      authHeaders,
      apprenticeId,
      standardId,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/cancel`)
      .set(authHeaders)
      .expect(201);

    const pg = createE2ePgClient();
    await pg.connect();
    let pushId: string;
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      const row = await pg.query<{ id: string }>(
        `SELECT id FROM withdrawal_completion_pushes
         WHERE "enrolmentId" = $1 AND "organisationId" = $2 AND "isDeleted" = false
         LIMIT 1`,
        [enrolmentId, orgId],
      );
      pushId = row.rows[0]?.id ?? '';
    } finally {
      await pg.end();
    }
    expect(pushId).toBeTruthy();

    await processWithdrawalPushJobInApp(app, {
      pushId,
      organisationId: orgId,
    });

    const failedListRes = await request(app.getHttpServer())
      .get('/api/v1/withdrawal-pushes/failed')
      .query({ page: 1, perPage: 10 })
      .set(authHeaders)
      .expect(200);

    expectPaginatedListEnvelope(failedListRes.body);
    const failedItems = (
      failedListRes.body as { data: { id: string; status: string }[] }
    ).data;
    expect(failedItems.some((item) => item.id === pushId)).toBe(true);
    expect(failedItems.find((item) => item.id === pushId)?.status).toBe(
      WithdrawalPushStatus.FAILED,
    );

    const getOneRes = await request(app.getHttpServer())
      .get(`/api/v1/withdrawal-pushes/${pushId}`)
      .set(authHeaders)
      .expect(200);

    expectSuccessEnvelope(getOneRes.body);
    const push = (
      getOneRes.body as {
        data: {
          id: string;
          status: string;
          enrolmentId: string;
          lastError: string | null;
        };
      }
    ).data;
    expect(push.id).toBe(pushId);
    expect(push.status).toBe(WithdrawalPushStatus.FAILED);
    expect(push.enrolmentId).toBe(enrolmentId);
    expect(push.lastError).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/api/v1/withdrawal-pushes/${pushId}/retry`)
      .set(authHeaders)
      .expect(204);

    const verifyPg = createE2ePgClient();
    await verifyPg.connect();
    let retriedStatus: string | undefined;
    let manualRetryRequestedAt: Date | null | undefined;
    try {
      await verifyPg.query(
        `SELECT set_config('app.rls_bootstrap', 'true', true)`,
      );
      const row = await verifyPg.query<{
        status: string;
        manualRetryRequestedAt: Date | null;
      }>(
        `SELECT status, "manualRetryRequestedAt"
         FROM withdrawal_completion_pushes
         WHERE id = $1`,
        [pushId],
      );
      retriedStatus = row.rows[0]?.status;
      manualRetryRequestedAt = row.rows[0]?.manualRetryRequestedAt;
    } finally {
      await verifyPg.end();
    }

    expect(retriedStatus).toBe(WithdrawalPushStatus.QUEUED);
    expect(manualRetryRequestedAt).toBeTruthy();
  });
});
