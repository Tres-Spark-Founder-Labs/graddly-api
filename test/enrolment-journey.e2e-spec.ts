import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';
import { Enrolment } from '../src/enrolments/entities/enrolment.entity.js';
import { OtjPaceAlertLevel } from '../src/otj/enums/otj-pace-alert-level.enum.js';
import { OtjPaceService } from '../src/otj/otj-pace.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { expectSuccessEnvelope } from './helpers/e2e-response-contracts.js';
import {
  createOrgOwnerContext,
  seedProgrammeGraph,
} from './helpers/programme-graph-e2e.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { App } from 'supertest/types';

describe('Enrolment journey + OTJ pace (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET/PATCH journey returns timeline, checklist, EPA countdown', async () => {
    const suffix = Date.now();
    const { authHeaders } = await createOrgOwnerContext(
      app,
      `Journey Org ${suffix}`,
    );
    const { apprenticeId, standardId } = await seedProgrammeGraph(
      app,
      authHeaders,
      { suffix },
    );
    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set(authHeaders)
      .send({
        apprenticeId,
        standardId,
        plannedStartDate: '2025-01-15',
        plannedEndDate: '2026-12-31',
      })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(authHeaders)
      .expect(201);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/journey`)
      .set(authHeaders)
      .send({ epaDate: '2026-09-01' })
      .expect(200);

    expectSuccessEnvelope(patchRes.body);
    expect((patchRes.body as { data: { epaDate: string } }).data.epaDate).toBe(
      '2026-09-01',
    );

    const journeyRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}/journey`)
      .set(authHeaders)
      .expect(200);

    expectSuccessEnvelope(journeyRes.body);
    const journey = (journeyRes.body as { data: Record<string, unknown> }).data;
    expect(journey.enrolmentId).toBe(enrolmentId);
    expect(journey.daysToEpa).toEqual(expect.any(Number));
    expect(journey.gatewayChecklist).toEqual(expect.any(Array));
    expect((journey.gatewayChecklist as unknown[]).length).toBeGreaterThan(0);
    expect(journey.milestones).toEqual(expect.any(Array));
    expect(journey.pace).toEqual(
      expect.objectContaining({
        approvedMinutes: expect.any(Number),
        totalTargetMinutes: expect.any(Number),
      }),
    );
  });

  it('pace evaluation persists alert level and creates notification', async () => {
    const suffix = Date.now();
    const apprentice = await createVerifiedUser(app, {
      email: `pace-apprentice-${suffix}@example.com`,
    });
    const { authHeaders } = await createOrgOwnerContext(
      app,
      `Pace Org ${suffix}`,
    );
    const { apprenticeId, standardId } = await seedProgrammeGraph(
      app,
      authHeaders,
      {
        suffix,
        apprenticeEmail: apprentice.email,
      },
    );
    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set(authHeaders)
      .send({
        apprenticeId,
        standardId,
        plannedStartDate: '2025-01-01',
        plannedEndDate: '2026-01-01',
      })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(authHeaders)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set(authHeaders)
      .send({ apprenticeUserId: apprentice.userId })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/journey`)
      .set(authHeaders)
      .send({ epaDate: '2026-01-01' })
      .expect(200);

    const pg = createE2ePgClient();
    await pg.connect();
    try {
      await pg.query(`SELECT set_config('app.rls_bootstrap', 'true', true)`);
      await pg.query(
        `UPDATE enrolments
         SET "plannedDurationMonths" = 12,
             "activatedAt" = '2025-01-01T00:00:00.000Z'
         WHERE id = $1`,
        [enrolmentId],
      );
    } finally {
      await pg.end();
    }

    const paceService = app.get(OtjPaceService);
    const pgLoad = createE2ePgClient();
    await pgLoad.connect();
    let enrolmentRow: Enrolment | undefined;
    try {
      await pgLoad.query(
        `SELECT set_config('app.rls_bootstrap', 'true', true)`,
      );
      const loaded = await pgLoad.query<Enrolment>(
        `SELECT * FROM enrolments WHERE id = $1`,
        [enrolmentId],
      );
      enrolmentRow = loaded.rows[0];
    } finally {
      await pgLoad.end();
    }
    expect(enrolmentRow).toBeTruthy();

    setCurrentOrganisationId(enrolmentRow.organisationId);
    setCurrentUserId(apprentice.userId);
    setLastKnownUserIdForGuc(apprentice.userId);
    await paceService.evaluateEnrolmentPace(enrolmentRow, {
      asOf: new Date('2025-10-01T00:00:00.000Z'),
    });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/enrolments/${enrolmentId}`)
      .set(authHeaders)
      .expect(200);

    const alertLevel = (getRes.body as { data: { otjPaceAlertLevel: string } })
      .data.otjPaceAlertLevel;
    expect([OtjPaceAlertLevel.AT_RISK, OtjPaceAlertLevel.OFF_TRACK]).toContain(
      alertLevel,
    );

    const pgNotif = createE2ePgClient();
    await pgNotif.connect();
    try {
      await pgNotif.query(
        `SELECT set_config('app.rls_bootstrap', 'true', true)`,
      );
      const rows = await pgNotif.query<{ type: string }>(
        `SELECT type FROM notifications
         WHERE "userId" = $1 AND type = 'otj'
         ORDER BY "createdAt" DESC LIMIT 1`,
        [apprentice.userId],
      );
      expect(rows.rowCount).toBeGreaterThan(0);
    } finally {
      await pgNotif.end();
    }
  });
});
