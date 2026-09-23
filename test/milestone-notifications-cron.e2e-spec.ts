import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { QUEUE_EMAIL } from '../src/bullmq/bullmq.constants.js';
import { EmailTemplate } from '../src/email/email-template.enum.js';
import { MilestoneNotificationsService } from '../src/enrolments/milestone-notifications.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';
import { MilestoneNotificationsCronService } from '../src/scheduler/milestone-notifications-cron.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { IEmailJobPayload } from '../src/email/email-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Client } from 'pg';
import type { App } from 'supertest/types';

/**
 * F3.4.3 AC2 — `milestone_completed`, driven at the cron.
 *
 * ── WHY AT THE CRON ─────────────────────────────────────────────────────────
 *
 * The sweep reads `enrolments` under the bootstrap rule and then acts inside
 * each enrolment's own organisation. Entered at the service with a tenant
 * context already set, both halves would be tested with an organisation the
 * real cron never has — which is exactly how the commitment chase came to
 * run clean and send nothing for months.
 *
 * ── WHAT IS PROVED HERE, AS OPPOSED TO IN THE UNIT SPEC ─────────────────────
 *
 * The unit spec owns the rules. This suite owns the things only a database
 * can answer: that the first sweep leaves seeded rows and no notification,
 * that a later completion produces one in-app row and one queued email, that
 * a second run produces neither, that a completed milestone which regresses
 * and completes again is still not announced twice, that two organisations
 * are each swept in their own context in one run, and that the check
 * constraint refuses a claim written before a delivery.
 *
 * The app connects as graddly_app with RLS enforced, asserted below.
 */
describe('Milestone notifications cron (e2e)', () => {
  let app: INestApplication<App>;
  let sudo: Client;

  type JourneyFixture = {
    orgId: string;
    enrolmentId: string;
    apprenticeUserId: string;
    apprenticeEmail: string;
    /** Completed before the first sweep: seeded, never announced. */
    historicReviewId: string;
    /** Still to come at the first sweep: the one that can announce. */
    laterReviewId: string;
    laterReviewOn: string;
  };

  const cron = () =>
    new MilestoneNotificationsCronService(
      app.get(ConfigService),
      new SchedulerRegistry(),
      new CronLockService(app.get(ConfigService), app.get(RedisService)),
      app.get(MilestoneNotificationsService),
    );

  /**
   * An activated enrolment with two reviews: one held, one scheduled.
   *
   * `reachable: false` gives the enrolment an apprentice who holds no
   * membership and has no email address — the pre-membership state of F1.2.5
   * AC3/AC5, where nothing can reach them.
   */
  const seedJourney = async (
    label: string,
    { reachable = true }: { reachable?: boolean } = {},
  ): Promise<JourneyFixture> => {
    const suffix = `${Date.now()}-${label}`;
    const owner = await createVerifiedUser(app, {
      email: `milestone-owner-${suffix}@example.com`,
      firstName: 'Ada',
    });
    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Milestone Provider ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    // The learner: the owner when they must be reachable (a member of the
    // organisation, with an address), otherwise a user who is neither.
    let apprenticeUserId = owner.userId;
    let apprenticeEmail = owner.email;
    if (!reachable) {
      const outsider = await createVerifiedUser(app, {
        email: `milestone-outsider-${suffix}@example.com`,
      });
      apprenticeUserId = outsider.userId;
      apprenticeEmail = '';
      // users.email is NOT NULL, so blank is how "no address" is stored.
      await sudo.query(`UPDATE users SET email = '' WHERE id = $1`, [
        outsider.userId,
      ]);
    }

    const apprentice = await sudo.query<{ id: string }>(
      `INSERT INTO apprentices ("organisationId", "firstName", "lastName", email)
       VALUES ($1, 'Milestone', 'Apprentice', $2) RETURNING id`,
      [orgId, `milestone-apprentice-${suffix}@example.com`],
    );
    const programme = await sudo.query<{ id: string }>(
      `INSERT INTO programmes ("organisationId", code, title)
       VALUES ($1, $2, 'Milestone Programme') RETURNING id`,
      [orgId, `MILE-PROG-${suffix}`],
    );
    const standard = await sudo.query<{ id: string }>(
      `INSERT INTO standards ("organisationId", "programmeId", code, title)
       VALUES ($1, $2, $3, 'Milestone Standard') RETURNING id`,
      [orgId, programme.rows[0].id, `MILE-STD-${suffix}`],
    );
    const enrolment = await sudo.query<{ id: string }>(
      `INSERT INTO enrolments
         ("organisationId", "apprenticeId", "standardId", status,
          "apprenticeUserId", "activatedAt", "plannedStartDate")
       VALUES ($1, $2, $3, 'active', $4, NOW() - INTERVAL '200 days',
               (NOW() - INTERVAL '200 days')::date)
       RETURNING id`,
      [orgId, apprentice.rows[0].id, standard.rows[0].id, apprenticeUserId],
    );

    const insertReview = async (
      title: string,
      status: string,
      scheduledSql: string,
    ) => {
      const row = await sudo.query<{ id: string; scheduledAt: Date }>(
        `INSERT INTO reviews
           ("organisationId", "enrolmentId", "apprenticeId", "scheduledAt",
            title, status, "apprenticeUserId", "tutorUserId", "employerManagerUserId")
         VALUES ($1, $2, $3, ${scheduledSql}, $4, $5, $6, $6, $6)
         RETURNING id, "scheduledAt"`,
        [
          orgId,
          enrolment.rows[0].id,
          apprentice.rows[0].id,
          title,
          status,
          apprenticeUserId,
        ],
      );
      return row.rows[0];
    };

    const historic = await insertReview(
      `Held review ${suffix}`,
      'completed',
      `NOW() - INTERVAL '90 days'`,
    );
    const later = await insertReview(
      `Next review ${suffix}`,
      'scheduled',
      `NOW() + INTERVAL '30 days'`,
    );

    return {
      orgId,
      enrolmentId: enrolment.rows[0].id,
      apprenticeUserId,
      apprenticeEmail,
      historicReviewId: historic.id,
      laterReviewId: later.id,
      laterReviewOn: later.scheduledAt.toISOString().slice(0, 10),
    };
  };

  type MarkerRow = {
    milestoneKey: string;
    outcome: string;
    notifiedAt: Date | null;
    completedOn: string | null;
    reason: string | null;
  };

  const markers = async (fixture: JourneyFixture): Promise<MarkerRow[]> => {
    const r = await sudo.query<MarkerRow>(
      // `completedOn` is cast to text: pg parses a `date` into a local-midnight
      // Date, which is the same day shifted by the runner's offset.
      `SELECT "milestoneKey", outcome, "notifiedAt", "completedOn"::text
              AS "completedOn", reason
         FROM enrolment_milestone_notifications
        WHERE "enrolmentId" = $1 AND "organisationId" = $2
        ORDER BY "milestoneKey"`,
      [fixture.enrolmentId, fixture.orgId],
    );
    return r.rows;
  };

  const milestoneNotifications = async (
    fixture: JourneyFixture,
  ): Promise<{ title: string; metadata: Record<string, unknown> }[]> => {
    const r = await sudo.query<{
      title: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT title, metadata FROM notifications
        WHERE "userId" = $1 AND "organisationId" = $2
          AND type = 'milestone_completed'
        ORDER BY "createdAt"`,
      [fixture.apprenticeUserId, fixture.orgId],
    );
    return r.rows;
  };

  const milestoneEmails = async (
    fixture: JourneyFixture,
  ): Promise<IEmailJobPayload[]> => {
    const queue = app.get<Queue<IEmailJobPayload>>(getQueueToken(QUEUE_EMAIL));
    const jobs = await queue.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'paused',
    ]);
    return jobs
      .map((job) => job.data)
      .filter(
        (data) =>
          data.template === EmailTemplate.MILESTONE_COMPLETED &&
          data.to === fixture.apprenticeEmail,
      );
  };

  const observedAt = async (fixture: JourneyFixture): Promise<Date | null> => {
    const r = await sudo.query<{ milestonesObservedAt: Date | null }>(
      `SELECT "milestonesObservedAt" FROM enrolments WHERE id = $1`,
      [fixture.enrolmentId],
    );
    return r.rows[0].milestonesObservedAt;
  };

  const complete = async (reviewId: string): Promise<void> => {
    await sudo.query(`UPDATE reviews SET status = 'completed' WHERE id = $1`, [
      reviewId,
    ]);
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

  it('records what is already complete on its first sweep, and announces none of it', async () => {
    const fixture = await seedJourney('first');

    await cron().handleMilestoneNotificationsCron();

    // Activated enrolment, induction and the review already held: three
    // complete milestones, all seeded, with the reason on the row.
    const rows = await markers(fixture);
    expect(rows.map((row) => row.milestoneKey)).toEqual([
      'enrolment',
      'induction',
      `review:${fixture.historicReviewId}`,
    ]);
    for (const row of rows) {
      expect(row.outcome).toBe('seeded');
      expect(row.notifiedAt).toBeNull();
      expect(row.reason).toContain('before the milestone sweep first observed');
    }
    expect(await milestoneNotifications(fixture)).toEqual([]);
    expect(await milestoneEmails(fixture)).toEqual([]);
    // And the enrolment is stamped, so the next sweep is not a first sweep.
    expect(await observedAt(fixture)).toBeInstanceOf(Date);
  });

  it('announces a milestone completed after that once, in app and by email', async () => {
    const fixture = await seedJourney('announce');
    await cron().handleMilestoneNotificationsCron();
    await complete(fixture.laterReviewId);

    await cron().handleMilestoneNotificationsCron();

    const notifications = await milestoneNotifications(fixture);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].metadata).toMatchObject({
      enrolmentId: fixture.enrolmentId,
      milestoneKey: `review:${fixture.laterReviewId}`,
    });

    const emails = await milestoneEmails(fixture);
    expect(emails).toHaveLength(1);
    expect(emails[0].context).toMatchObject({
      firstName: 'Ada',
      // The date the timeline shows, which for a review is the date it was
      // scheduled for — never the row's mutable `updatedAt`.
      milestoneDate: fixture.laterReviewOn,
    });

    const marker = (await markers(fixture)).find(
      (row) => row.milestoneKey === `review:${fixture.laterReviewId}`,
    );
    expect(marker?.outcome).toBe('notified');
    expect(marker?.notifiedAt).toBeInstanceOf(Date);
    expect(marker?.completedOn).toBe(fixture.laterReviewOn);
    expect(marker?.reason).toBeNull();

    // The next sweep says nothing further: the marker accounts for it.
    await cron().handleMilestoneNotificationsCron();

    expect(await milestoneNotifications(fixture)).toHaveLength(1);
    expect(await milestoneEmails(fixture)).toHaveLength(1);
  });

  /**
   * The recorded decision: a marker is permanent. A review rescheduled after
   * it was completed moves its milestone backwards, and completing it again
   * does not announce it a second time.
   *
   * This is deliberately unlike `reconcileGatewayReadiness`, which clears
   * both of its markers when readiness lapses and therefore does re-notify.
   * The difference, and why, is written beside both mechanisms.
   */
  it('never announces a milestone twice after it regresses and completes again', async () => {
    const fixture = await seedJourney('regress');
    await cron().handleMilestoneNotificationsCron();
    await complete(fixture.laterReviewId);
    await cron().handleMilestoneNotificationsCron();
    expect(await milestoneNotifications(fixture)).toHaveLength(1);

    // Rescheduled: the milestone goes back to upcoming.
    await sudo.query(
      `UPDATE reviews
          SET status = 'scheduled', "scheduledAt" = NOW() + INTERVAL '45 days'
        WHERE id = $1`,
      [fixture.laterReviewId],
    );
    await cron().handleMilestoneNotificationsCron();

    // And held: complete again.
    await complete(fixture.laterReviewId);
    await cron().handleMilestoneNotificationsCron();

    expect(await milestoneNotifications(fixture)).toHaveLength(1);
    expect(await milestoneEmails(fixture)).toHaveLength(1);
    expect(
      (await markers(fixture)).filter(
        (row) => row.milestoneKey === `review:${fixture.laterReviewId}`,
      ),
    ).toHaveLength(1);
  });

  it("announces each organisation's own enrolment in one run", async () => {
    const first = await seedJourney('org-a');
    const second = await seedJourney('org-b');
    await cron().handleMilestoneNotificationsCron();
    await complete(first.laterReviewId);
    await complete(second.laterReviewId);

    await cron().handleMilestoneNotificationsCron();

    // One run, two organisations: the context is entered per enrolment, not
    // once for the sweep.
    expect(await milestoneNotifications(first)).toHaveLength(1);
    expect(await milestoneNotifications(second)).toHaveLength(1);
  });

  /**
   * Nothing reached the learner, so nothing is recorded — the milestone stays
   * eligible. A marker written as a claim before delivery is what turned six
   * emitters into permanent silence in an earlier batch.
   */
  it('writes no marker when nothing can reach the learner, and tries again on the next sweep', async () => {
    const fixture = await seedJourney('unreached', { reachable: false });
    await cron().handleMilestoneNotificationsCron();
    await complete(fixture.laterReviewId);

    await cron().handleMilestoneNotificationsCron();
    const afterFirstAttempt = await markers(fixture);
    await cron().handleMilestoneNotificationsCron();
    const afterSecondAttempt = await markers(fixture);

    const keyed = (rows: MarkerRow[]) =>
      rows.filter(
        (row) => row.milestoneKey === `review:${fixture.laterReviewId}`,
      );
    expect(keyed(afterFirstAttempt)).toEqual([]);
    expect(keyed(afterSecondAttempt)).toEqual([]);
    expect(await milestoneNotifications(fixture)).toEqual([]);
  });

  /**
   * The database holds the two meanings apart, so a future caller cannot
   * write a claim and call it a delivery.
   */
  it('refuses a notified row with no delivery time, and a seeded row with one', async () => {
    const fixture = await seedJourney('constraint');

    await expect(
      sudo.query(
        `INSERT INTO enrolment_milestone_notifications
           ("organisationId", "enrolmentId", "milestoneKey", outcome, "notifiedAt")
         VALUES ($1, $2, 'claimed-without-sending', 'notified', NULL)`,
        [fixture.orgId, fixture.enrolmentId],
      ),
    ).rejects.toThrow(/CHK_enrolment_milestone_notifications_notified_at/);

    await expect(
      sudo.query(
        `INSERT INTO enrolment_milestone_notifications
           ("organisationId", "enrolmentId", "milestoneKey", outcome, "notifiedAt")
         VALUES ($1, $2, 'seeded-with-a-send-time', 'seeded', NOW())`,
        [fixture.orgId, fixture.enrolmentId],
      ),
    ).rejects.toThrow(/CHK_enrolment_milestone_notifications_notified_at/);
  });
});
