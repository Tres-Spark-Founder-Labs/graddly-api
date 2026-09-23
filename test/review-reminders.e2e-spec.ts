import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { QUEUE_EMAIL } from '../src/bullmq/bullmq.constants.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { EmailTemplate } from '../src/email/email-template.enum.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ReviewReminderKind } from '../src/reviews/enums/review-reminder-kind.enum.js';
import { ReviewsReminderService } from '../src/reviews/reviews-reminder.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';
import { ReviewRemindersCronService } from '../src/scheduler/review-reminders-cron.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { IEmailJobPayload } from '../src/email/email-job.payload.js';
import type { Queue } from 'bullmq';
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

  /**
   * A smaller fixture: one organisation with one review inside the 48-hour
   * window, and a participant who is **not** a member of it — the
   * pre-membership state (F1.2.5), which is what the reminder has to cope
   * with. The organisation's owner is a separate user, because an owner is a
   * member of their own organisation and would hide that state.
   */
  const seedReviewInWindow = async (
    label: string,
  ): Promise<{ orgId: string; reviewId: string; apprenticeUserId: string }> => {
    const suffix = `${Date.now()}-${label}`;
    const owner = await createVerifiedUser(app, {
      email: `reminder-${suffix}@example.com`,
    });
    const participant = await createVerifiedUser(app, {
      email: `reminder-participant-${suffix}@example.com`,
    });
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Reminder Scope ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const apprenticeRow = await sudo.query<{ id: string }>(
      `INSERT INTO apprentices ("organisationId", "firstName", "lastName", email)
       VALUES ($1, 'Scope', 'Apprentice', $2) RETURNING id`,
      [orgId, `reminder-scope-appr-${suffix}@example.com`],
    );
    const programme = await sudo.query<{ id: string }>(
      `INSERT INTO programmes ("organisationId", code, title)
       VALUES ($1, $2, 'Scope Programme') RETURNING id`,
      [orgId, `REM-SCOPE-PROG-${suffix}`],
    );
    const standard = await sudo.query<{ id: string }>(
      `INSERT INTO standards ("organisationId", "programmeId", code, title)
       VALUES ($1, $2, $3, 'Scope Standard') RETURNING id`,
      [orgId, programme.rows[0].id, `REM-SCOPE-STD-${suffix}`],
    );
    const enrolment = await sudo.query<{ id: string }>(
      `INSERT INTO enrolments ("organisationId", "apprenticeId", "standardId", status, "apprenticeUserId")
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [
        orgId,
        apprenticeRow.rows[0].id,
        standard.rows[0].id,
        participant.userId,
      ],
    );
    const review = await sudo.query<{ id: string }>(
      `INSERT INTO reviews
         ("organisationId", "enrolmentId", "apprenticeId", "scheduledAt", title,
          status, "apprenticeUserId", "tutorUserId", "employerManagerUserId")
       VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $6, $6) RETURNING id`,
      [
        orgId,
        enrolment.rows[0].id,
        apprenticeRow.rows[0].id,
        FORTY_EIGHT_HOURS_AT,
        `scope review ${suffix}`,
        participant.userId,
      ],
    );

    return {
      orgId,
      reviewId: review.rows[0].id,
      apprenticeUserId: participant.userId,
    };
  };

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
     * No membership rows, deliberately.
     *
     * Between the employer creating a profile and the apprentice creating
     * their account (F1.2.5 AC1/AC3/AC5) a named participant holds no
     * membership, so `app_create_notification` writes nothing and returns
     * null. That is the population F2.2.3's reminders and F3.4.1 AC6's chase
     * exist for, and it is the state this suite runs in: the reminder has to
     * reach them by email, and the dispatch row has to reflect that rather
     * than a notification that never landed.
     */

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

    /**
     * AC3 names learner, employer and tutor for the day-based reminders; the
     * 48-hour one is the apprentice's alone. None of them is a member yet, so
     * the channel that reaches them is email — asserted on the real queue.
     */
    const emailQueue = app.get<Queue<IEmailJobPayload>>(
      getQueueToken(QUEUE_EMAIL),
    );
    const reminderEmails = (
      await emailQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])
    ).filter((job) => job.data.template === EmailTemplate.REVIEW_REMINDER);
    const recipientsOf = (title: string): string[] =>
      reminderEmails
        .filter((job) => String(job.data.context.reviewTitle) === title)
        .map((job) => job.data.to)
        .sort();

    expect(recipientsOf(`7-day reminder review ${suffix}`)).toEqual(
      [apprentice.email, tutor.email, manager.email].sort(),
    );
    expect(recipientsOf(`1-day reminder review ${suffix}`)).toEqual(
      [apprentice.email, tutor.email, manager.email].sort(),
    );
    expect(recipientsOf(`48-hour reminder review ${suffix}`)).toEqual([
      apprentice.email,
    ]);

    // And no in-app notification for any of them: not members yet, so
    // app_create_notification wrote nothing and said so.
    const inApp = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications
        WHERE "organisationId" = $1 AND type = 'review'`,
      [orgId],
    );
    expect(Number(inApp.rows[0].n)).toBe(0);

    // The guard: a second run at the same hour sends nothing further.
    await cron().handleReviewRemindersCron(NOW);
    const after = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches WHERE "reviewId" = ANY($1::uuid[])`,
      [[sevenDayReviewId, oneDayReviewId, fortyEightHourReviewId]],
    );
    expect(Number(after.rows[0].n)).toBe(3);
  });

  /**
   * The guard, now that `review_reminder_dispatches` carries an organisation
   * and a policy (migration 1781100000062).
   *
   * One organisation's recorded reminder must not suppress another's, and
   * must still suppress its own. Read with no organisation the guard matches
   * nothing and every run reminds again; read across tenants it matches a
   * row that is not its own and that reminder never goes out.
   */
  it("does not let one organisation's recorded reminder suppress another's", async () => {
    const first = await seedReviewInWindow('sup-a');
    const second = await seedReviewInWindow('sup-b');

    // The first organisation's own dispatch row, as a previous run would
    // have left it.
    await sudo.query(
      `INSERT INTO review_reminder_dispatches ("organisationId", "reviewId", "reminderKind")
       VALUES ($1, $2, '48h')`,
      [first.orgId, first.reviewId],
    );

    await cron().handleReviewRemindersCron(NOW);

    const rows = await sudo.query<{
      reviewId: string;
      organisationId: string;
    }>(
      `SELECT "reviewId", "organisationId" FROM review_reminder_dispatches
        WHERE "reviewId" = ANY($1::uuid[])`,
      [[first.reviewId, second.reviewId]],
    );
    // The second organisation is reminded; the first is not reminded twice.
    expect(rows.rows.filter((r) => r.reviewId === second.reviewId)).toEqual([
      { reviewId: second.reviewId, organisationId: second.orgId },
    ]);
    expect(rows.rows.filter((r) => r.reviewId === first.reviewId)).toHaveLength(
      1,
    );
    // And no notification for the already-reminded one.
    const notified = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications
        WHERE "organisationId" = $1 AND type = 'review' AND metadata->>'reviewId' = $2`,
      [first.orgId, first.reviewId],
    );
    expect(Number(notified.rows[0].n)).toBe(0);
  });

  /**
   * Reached nobody: no dispatch row, and the reminder stays eligible.
   *
   * `notifySigners` used to count `createForUser`'s null — the
   * pre-membership state — as a delivery, and the caller writes the dispatch
   * row on that count. The dispatch row is the already-sent guard, so a
   * recipient who could not be reached had their reminder recorded as sent
   * and suppressed for good: exactly the invited-but-not-joined apprentice
   * the reminder exists for.
   *
   * The decision recorded here: **no dispatch row, retry on the next sweep**.
   * The pre-membership gap is temporary by design (F1.2.5 AC3/AC5), so an
   * un-stamped review is delivered as soon as a channel opens, with no new
   * column and no second retry rule to get wrong. The cost is honest and
   * bounded: a retry only helps while the review is still inside its window
   * (that UTC day, or 48±1 hours), so if no channel opens before the window
   * closes the reminder is missed — which is better than recorded as sent.
   */
  it('records nothing when no channel reached the recipient, and stays eligible', async () => {
    const scope = await seedReviewInWindow('unreachable');

    // Not a member (so no in-app row) and no email address: nothing can
    // reach them. users.email is NOT NULL, so blank is the reachable state.
    await sudo.query(`UPDATE users SET email = '' WHERE id = $1`, [
      scope.apprenticeUserId,
    ]);

    await cron().handleReviewRemindersCron(NOW);

    const dispatches = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches WHERE "reviewId" = $1`,
      [scope.reviewId],
    );
    expect(Number(dispatches.rows[0].n)).toBe(0);
    const notifications = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications WHERE "organisationId" = $1`,
      [scope.orgId],
    );
    expect(Number(notifications.rows[0].n)).toBe(0);

    // Still eligible: once a channel opens, the next sweep delivers it.
    await sudo.query(`UPDATE users SET email = $2 WHERE id = $1`, [
      scope.apprenticeUserId,
      `reminder-reachable-${Date.now()}@example.com`,
    ]);
    await cron().handleReviewRemindersCron(NOW);

    const after = await sudo.query<{ n: string }>(
      `SELECT count(*) AS n FROM review_reminder_dispatches WHERE "reviewId" = $1`,
      [scope.reviewId],
    );
    expect(Number(after.rows[0].n)).toBe(1);
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
