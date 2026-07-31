import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { QUEUE_EMAIL } from '../src/bullmq/bullmq.constants.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';
import { OtjDigestService } from '../src/notifications/otj-digest.service.js';
import { OtjActivityCategory } from '../src/otj/enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../src/otj/enums/otj-log-status.enum.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';

import type { Queue } from 'bullmq';
import type { App } from 'supertest/types';

describe('OTJ digest (e2e)', () => {
  let app: INestApplication<App>;
  let emailQueue: Queue;

  beforeAll(async () => {
    app = await createE2eApp();
    emailQueue = app.get(getQueueToken(QUEUE_EMAIL));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends weekly digest email for managers with pending OTJ approvals', async () => {
    const suffix = Date.now();
    const manager = await createVerifiedUser(app, {
      email: `digest-manager-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send(buildOrgPayload(`Digest Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `DIG-PROG-${suffix}`,
        title: 'Digest Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        programmeId,
        code: `DIG-STD-${suffix}`,
        title: 'Digest Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Digest',
        lastName: 'Apprentice',
        email: `digest-apprentice-${suffix}@example.com`,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ employerManagerUserId: manager.userId })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    const otjRes = await request(app.getHttpServer())
      .post('/api/v1/otj-log-entries')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        loggedDate: '2026-01-15',
        minutes: 90,
        activityName: 'Workshop',
        category: OtjActivityCategory.TAUGHT_LEARNING,
      })
      .expect(201);
    const otjId = (otjRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/otj-log-entries/${otjId}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ status: OtjLogStatus.SUBMITTED })
      .expect(200);

    setCurrentOrganisationId(orgId);
    setCurrentUserId(manager.userId);
    setLastKnownUserIdForGuc(manager.userId);

    const countsBefore = await emailQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
    );
    const digestService = app.get(OtjDigestService);
    /**
     * F1.2.3 AC7 — the cron now runs daily and each manager's daily/weekly/off
     * preference is applied at send time. The default is weekly, which sends
     * on Mondays only, so `now` is pinned to a known Monday (3 August 2026).
     *
     * Without it this test would pass one day in seven and fail the other six
     * — a rename alone was not enough, because the method gained a cadence
     * decision it did not have before.
     */
    const MONDAY = new Date('2026-08-03T08:00:00Z');
    const sent = await digestService.sendDigestForOrganisation(orgId, MONDAY);

    expect(sent).toBe(1);
    const countsAfter = await emailQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
    );
    const totalBefore =
      countsBefore.waiting +
      countsBefore.active +
      countsBefore.delayed +
      countsBefore.completed;
    const totalAfter =
      countsAfter.waiting +
      countsAfter.active +
      countsAfter.delayed +
      countsAfter.completed;
    expect(totalAfter).toBeGreaterThan(totalBefore);
  });
});
