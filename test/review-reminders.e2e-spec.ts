import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ReviewReminderKind } from '../src/reviews/enums/review-reminder-kind.enum.js';
import { ReviewsReminderService } from '../src/reviews/reviews-reminder.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';
import { ReviewRemindersCronService } from '../src/scheduler/review-reminders-cron.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { Client } from 'pg';
import type { App } from 'supertest/types';

/**
 * F2.2.3 AC3 — the 7-day, 1-day and 48-hour review reminders, driven at the
 * cron, all three of them.
 *
 * ── WHY THIS DRIVES THE CRON, AND WHY THE HOUR IS A PARAMETER ───────────────
 *
 * This suite used to call `ReviewsReminderService.sendDueReminders()` after
 * `enterTenantContext`, so it ran with an organisation the real cron never
 * has — the service's own comment says as much. It also could only ever
 * reach the 48-hour reminder: the 7-day and 1-day ones are sent on the
 * 07:00 UTC run alone, and the clock was read inside the service. Two of
 * three paths were untestable, and nothing said so.
 *
 * `now` is now a parameter of both the cron method and the service, the way
 * the OTJ digest's already is. So: three reviews, one for each window, one
 * run of the cron at a fixed 07:00 UTC, and all three reminders asserted —
 * with the recipients each kind is supposed to reach.
 *
 * The app connects as graddly_app with RLS enforced, asserted below; the
 * dispatch rows and notifications are read back with the superuser client so
 * the assertions do not depend on the same policies the job used.
 */
describe('Review reminders at the cron (e2e)', () => {
  let app: INestApplication<App>;
  let sudo: Client;

  /** 07:00 UTC, comfortably in the future of any fixture the API accepts. */
  const NOW = new Date('2026-11-04T07:00:00Z');
  /** Within the 7-day UTC day. */
  const SEVEN_DAYS_AT = new Date('2026-11-11T10:00:00Z');
  /** Within the 1-day UTC day. */
  const ONE_DAY_AT = new Date('2026-11-05T10:00:00Z');
  /** Inside the 48-hour ±1-hour window. */
  const FORTY_EIGHT_HOURS_AT = new Date('2026-11-06T07:00:00Z');

  const cron = () =>
    new ReviewRemindersCronService(
      app.get(ConfigService),
      new SchedulerRegistry(),
      new CronLockService(app.get(ConfigService), app.get(RedisService)),
      app.get(ReviewsReminderService),
    );

  beforeAll(async () => {
    app = await createE2eApp();
    sudo = createE2ePgClient();
    await sudo.connect();
  });

  afterAll(async () => {
    await app?.close();
    await sudo?.end();
  });

  it('runs as graddly_app with RLS enforced', async () => {
    const [row] = await app
      .get(DataSource)
      .query<
        { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(`SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(row).toEqual({
      role: 'graddly_app',
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('sends the 7-day, 1-day and 48-hour reminders in one 07:00 UTC run', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `reminder-owner-${suffix}@example.com`,
    });
    const apprentice = await createVerifiedUser(app, {
      email: `reminder-apprentice-${suffix}@example.com`,
    });
    const tutor = await createVerifiedUser(app, {
      email: `reminder-tutor-${suffix}@example.com`,
    });
    const manager = await createVerifiedUser(app, {
      email: `reminder-manager-${suffix}@example.com`,
    });

    const headers = (orgId?: string): Record<string, string> => {
      const base: Record<string, string> = {
        ['Authorization']: `Bearer ${owner.accessToken}`,
      };
      if (orgId) base[ORGANISATION_ID_HEADER] = orgId;
      return base;
    };

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set(headers())
      .send(buildOrgPayload(`Reminder Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set(headers(orgId))
      .send({
        code: `REM-PROG-${suffix}`,
        title: 'Reminder Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set(headers(orgId))
      .send({
        programmeId,
        code: `REM-STD-${suffix}`,
        title: 'Reminder Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set(headers(orgId))
      .send({
        firstName: 'Reminder',
        lastName: 'Apprentice',
        email: apprentice.email,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set(headers(orgId))
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set(headers(orgId))
      .send({
        apprenticeUserId: apprentice.userId,
        tutorUserId: tutor.userId,
        employerManagerUserId: manager.userId,
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set(headers(orgId))
      .expect(201);

    /**
     * The three recipients are members of the organisation.
     *
     * `app_create_notification` treats "recipient is not a member yet" as a
     * normal pre-membership state and returns null (F1.2.5), so without
     * these rows the reminder writes no in-app notification and the suite
     * would be asserting the pre-membership path instead of AC3's.
     */
    for (const userId of [apprentice.userId, tutor.userId, manager.userId]) {
      await sudo.query(
        `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [orgId, userId],
      );
    }

    const createReview = async (
      title: string,
      scheduledAt: Date,
    ): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set(headers(orgId))
        .send({
          enrolmentId,
          apprenticeId,
          scheduledAt: scheduledAt.toISOString(),
          title,
          apprenticeUserId: apprentice.userId,
          tutorUserId: tutor.userId,
          employerManagerUserId: manager.userId,
        })
        .expect(201);
      return (res.body as { data: { id: string } }).data.id;
    };

    const sevenDayReviewId = await createReview(
      `7-day reminder review ${suffix}`,
      SEVEN_DAYS_AT,
    );
    const oneDayReviewId = await createReview(
      `1-day reminder review ${suffix}`,
      ONE_DAY_AT,
    );
    const fortyEightHourReviewId = await createReview(
      `48-hour reminder review ${suffix}`,
      FORTY_EIGHT_HOURS_AT,
    );

    // One run, at 07:00 UTC, entered at the cron: its own context, no
    // organisation, no user.
    await cron().handleReviewRemindersCron(NOW);

    const dispatches = await sudo.query<{
      reviewId: string;
      reminderKind: string;
    }>(
      `SELECT "reviewId", "reminderKind" FROM review_reminder_dispatches
        WHERE "reviewId" = ANY($1::uuid[]) ORDER BY "reminderKind"`,
      [[sevenDayReviewId, oneDayReviewId, fortyEightHourReviewId]],
    );
    expect(
      dispatches.rows.map((r) => [r.reviewId, r.reminderKind]).sort(),
    ).toEqual(
      [
        [sevenDayReviewId, ReviewReminderKind.SEVEN_DAYS],
        [oneDayReviewId, ReviewReminderKind.ONE_DAY],
        [fortyEightHourReviewId, ReviewReminderKind.FORTY_EIGHT_HOURS],
      ].sort(),
    );

    // AC3 names learner, employer and tutor for the day-based reminders; the
    // 48-hour one is the apprentice's alone.
    const recipients = async (reviewId: string): Promise<string[]> => {
      const r = await sudo.query<{ userId: string }>(
        `SELECT "userId" FROM notifications
          WHERE "organisationId" = $1 AND type = 'review'
            AND metadata->>'reviewId' = $2`,
        [orgId, reviewId],
      );
      return r.rows.map((row) => row.userId).sort();
    };

    expect(await recipients(sevenDayReviewId)).toEqual(
      [apprentice.userId, tutor.userId, manager.userId].sort(),
    );
    expect(await recipients(oneDayReviewId)).toEqual(
      [apprentice.userId, tutor.userId, manager.userId].sort(),
    );
    expect(await recipients(fortyEightHourReviewId)).toEqual([
      apprentice.userId,
    ]);

    // The guard: a second run at the same hour sends nothing further.
    await cron().handleReviewRemindersCron(NOW);
    const after = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches WHERE "reviewId" = ANY($1::uuid[])`,
      [[sevenDayReviewId, oneDayReviewId, fortyEightHourReviewId]],
    );
    expect(Number(after.rows[0].n)).toBe(3);
  });

  it('sends no day-based reminder on a run at any other hour', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `reminder-hour-owner-${suffix}@example.com`,
    });
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Reminder Hour Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const before = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches`,
    );

    // 09:00 UTC: the 7-day and 1-day windows are closed, and the 48-hour
    // window holds nothing for this organisation.
    await cron().handleReviewRemindersCron(new Date('2026-11-04T09:00:00Z'));

    const after = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches`,
    );
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));
    const notifications = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications WHERE "organisationId" = $1`,
      [orgId],
    );
    expect(Number(notifications.rows[0].n)).toBe(0);
  });
});
