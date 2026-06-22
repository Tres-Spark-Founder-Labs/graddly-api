import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { InterventionActionType } from '../../src/learners/enums/intervention-action-type.enum.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';
import { createProviderDirectoryContext } from '../helpers/reporting-e2e.js';
import { createE2ePgClient } from '../helpers/rls-db.js';

import type { App } from 'supertest/types';

describe('Intervention queue (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function flagEnrolmentOffTrack(enrolmentId: string) {
    const pg = createE2ePgClient();
    await pg.connect();
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      await pg.query(
        `UPDATE enrolments SET "otjPaceAlertLevel" = 'off_track' WHERE id = $1`,
        [enrolmentId],
      );
    } finally {
      await pg.end();
    }
  }

  it('lists at-risk enrolments and logs intervention actions', async () => {
    const ctx = await createProviderDirectoryContext(app, 'intervention');
    await flagEnrolmentOffTrack(ctx.enrolmentId);

    const queueRes = await request(app.getHttpServer())
      .get('/api/v1/learners/intervention-queue')
      .set(ctx.authHeaders)
      .expect(200);

    expectSuccessEnvelope(queueRes.body);
    const queue = (
      queueRes.body as {
        data: { items: { enrolmentId: string }[]; atRiskCount: number };
      }
    ).data;
    expect(queue.atRiskCount).toBeGreaterThanOrEqual(1);
    expect(
      queue.items.some((item) => item.enrolmentId === ctx.enrolmentId),
    ).toBe(true);

    const actionRes = await request(app.getHttpServer())
      .post(`/api/v1/learners/${ctx.enrolmentId}/interventions`)
      .set(ctx.authHeaders)
      .send({
        actionType: InterventionActionType.CONTACT_MADE,
        notes: 'Spoke with learner',
      })
      .expect(201);

    expectSuccessEnvelope(actionRes.body);
    const action = (
      actionRes.body as { data: { actionType: string; notes: string } }
    ).data;
    expect(action.actionType).toBe(InterventionActionType.CONTACT_MADE);
    expect(action.notes).toBe('Spoke with learner');
  });
});
