import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';

import { QUEUE_DIGEST, QUEUE_EMAIL } from '../src/bullmq/bullmq.constants.js';
import { DigestProcessor } from '../src/bullmq/processors/digest.processor.js';
import { EmailSendProcessor } from '../src/bullmq/processors/email-send.processor.js';
import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import { EMAIL_JOB_SEND } from '../src/email/email-job.constants.js';
import { EmailPayloadFactory } from '../src/email/email-payload.factory.js';
import { EmailTemplate } from '../src/email/email-template.enum.js';
import { EmailService } from '../src/email/email.service.js';
import {
  EMAIL_SENDER,
  type IEmailMessage,
  type IEmailSender,
} from '../src/email/interfaces/email-sender.interface.js';
import { DigestDispatchService } from '../src/notifications/digest-dispatch.service.js';
import { OtjDigestService } from '../src/notifications/otj-digest.service.js';
import { OtjLogEntry } from '../src/otj/entities/otj-log-entry.entity.js';
import { OtjActivityCategory } from '../src/otj/enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../src/otj/enums/otj-log-status.enum.js';
import { RedisService } from '../src/redis/redis.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';
import { DigestCronService } from '../src/scheduler/digest-cron.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { IEmailJobPayload } from '../src/email/email-job.payload.js';
import type { IWeeklyOtjDigestJobPayload } from '../src/notifications/digest-job.payload.js';
import type { Job, Queue } from 'bullmq';
import type { App } from 'supertest/types';

/**
 * F1.2.3 AC6/AC7 — the line manager's digest of OTJ entries awaiting
 * approval, proved by the cron and the worker, as they run.
 *
 * ── WHY THIS WAS REWRITTEN ──────────────────────────────────────────────────
 *
 * The test this replaces passed on two coincidences. It called
 * `OtjDigestService` directly with the manager as the current user, so the
 * manager could read their own user row and `ensureDefaults` could insert
 * their preference rows as themself. And the manager owned the only
 * organisation, the one that owned the entries, so they were visible there
 * anyway. In production neither holds: the worker runs with no user, in the
 * provider's organisation, and the manager belongs to the employer's. A
 * rolled-back probe as graddly_app showed the digest could never send — the
 * cron found no organisations, the worker found no managers, and the
 * preference insert was refused.
 *
 * ── WHAT RUNS HERE ──────────────────────────────────────────────────────────
 *
 * - The provider and the employer are separate organisations. The manager is
 *   a member of the employer only (asserted, not assumed).
 * - `DigestCronService.handleDigestCron`, the worker's cron, through the real
 *   `CronLockService`: its own context, no organisation, no user. It lives in
 *   the worker module, which the e2e app does not load, so it is built here
 *   from the app's own providers exactly as that module wires it.
 * - `DigestProcessor.process` on the job the cron queued: the job's
 *   organisation, no user.
 * - The email job it queues, through the email worker's processor, the real
 *   renderer and templates, to the sender. Only the sender is a double.
 * - The manager's own cadence, set through the API, decides both runs: daily
 *   sends; off does not. Were the recipient's preference unreadable in the
 *   worker, the weekly default would apply — and one of the two runs would
 *   fail on every day of the week.
 *
 * The app connects as graddly_app, RLS enforced (asserted below).
 */
describe('OTJ approval digest, driven by the cron and the digest worker (e2e)', () => {
  let app: INestApplication<App>;
  let digestQueue: Queue<IWeeklyOtjDigestJobPayload>;
  let emailQueue: Queue<IEmailJobPayload>;

  beforeAll(async () => {
    app = await createE2eApp();
    digestQueue = app.get(getQueueToken(QUEUE_DIGEST));
    emailQueue = app.get(getQueueToken(QUEUE_EMAIL));
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (path: string, token: string, orgId?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`);
    return orgId ? req.set(ORGANISATION_ID_HEADER, orgId) : req;
  };
  const patch = (path: string, token: string, orgId?: string) => {
    const req = request(app.getHttpServer())
      .patch(path)
      .set('Authorization', `Bearer ${token}`);
    return orgId ? req.set(ORGANISATION_ID_HEADER, orgId) : req;
  };
  const idOf = (res: request.Response): string =>
    (res.body as { data: { id: string } }).data.id;

  const pendingJobs = <T>(queue: Queue<T>) =>
    queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);

  it('reaches a line manager in another organisation, at the cadence the manager chose', async () => {
    const suffix = Date.now();

    // ── The connection ─────────────────────────────────────────────────────
    const [connection] = await app
      .get(DataSource)
      .query<
        { role: string; bypass: boolean }[]
      >(`SELECT current_user AS role, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`);
    expect(connection).toEqual({ role: 'graddly_app', bypass: false });

    // ── The provider: owns the enrolment and the entry ─────────────────────
    const tutor = await createVerifiedUser(app, {
      email: `digest-provider-${suffix}@example.com`,
    });
    const providerOrgId = idOf(
      await post('/api/v1/organisations', tutor.accessToken)
        .send({
          ...buildOrgPayload(`Digest Provider ${suffix}`),
          portalType: 'provider',
        })
        .expect(201),
    );

    // ── The employer: the manager's own organisation, and only theirs ──────
    const manager = await createVerifiedUser(app, {
      email: `digest-manager-${suffix}@example.com`,
    });
    const employerOrgId = idOf(
      await post('/api/v1/organisations', manager.accessToken)
        .send({
          ...buildOrgPayload(`Digest Employer ${suffix}`),
          portalType: 'employer',
        })
        .expect(201),
    );

    const sudo = createE2ePgClient();
    await sudo.connect();
    try {
      const memberships = await sudo.query<{ organisationId: string }>(
        `SELECT "organisationId" FROM organisation_memberships
          WHERE "userId" = $1 AND "isDeleted" = false`,
        [manager.userId],
      );
      expect(memberships.rows).toEqual([{ organisationId: employerOrgId }]);
    } finally {
      await sudo.end();
    }

    const programmeId = idOf(
      await post('/api/v1/programmes', tutor.accessToken, providerOrgId)
        .send({
          code: `DIG-PROG-${suffix}`,
          title: 'Digest Programme',
          status: 'active',
        })
        .expect(201),
    );
    const standardId = idOf(
      await post('/api/v1/standards', tutor.accessToken, providerOrgId)
        .send({
          programmeId,
          code: `DIG-STD-${suffix}`,
          title: 'Digest Standard',
          status: 'active',
        })
        .expect(201),
    );
    const apprenticeId = idOf(
      await post('/api/v1/apprentices', tutor.accessToken, providerOrgId)
        .send({
          firstName: 'Digest',
          lastName: 'Apprentice',
          email: `digest-apprentice-${suffix}@example.com`,
        })
        .expect(201),
    );
    const enrolmentId = idOf(
      await post('/api/v1/enrolments', tutor.accessToken, providerOrgId)
        .send({ apprenticeId, standardId })
        .expect(201),
    );
    await patch(
      `/api/v1/enrolments/${enrolmentId}/organisation-links`,
      tutor.accessToken,
      providerOrgId,
    )
      .send({ employerOrganisationId: employerOrgId })
      .expect(200);
    await patch(
      `/api/v1/enrolments/${enrolmentId}/participants`,
      tutor.accessToken,
      providerOrgId,
    )
      .send({ employerManagerUserId: manager.userId })
      .expect(200);
    await post(
      `/api/v1/enrolments/${enrolmentId}/activate`,
      tutor.accessToken,
      providerOrgId,
    ).expect(201);

    const activityName = `Digest workshop ${suffix}`;
    const entryId = idOf(
      await post('/api/v1/otj-log-entries', tutor.accessToken, providerOrgId)
        .send({
          enrolmentId,
          apprenticeId,
          loggedDate: '2026-01-15',
          minutes: 90,
          activityName,
          category: OtjActivityCategory.TAUGHT_LEARNING,
        })
        .expect(201),
    );
    await patch(
      `/api/v1/otj-log-entries/${entryId}`,
      tutor.accessToken,
      providerOrgId,
    )
      .send({ status: OtjLogStatus.SUBMITTED })
      .expect(200);

    // AC7 — the manager asks for a daily digest, as themself.
    await patch('/api/v1/notifications/preferences/digest', manager.accessToken)
      .send({ frequency: 'daily' })
      .expect(200);

    // ── The cron, as the worker module wires it ────────────────────────────
    const config = app.get(ConfigService);
    const cron = new DigestCronService(
      config,
      new SchedulerRegistry(),
      new CronLockService(config, app.get(RedisService)),
      app.get(DigestDispatchService),
      app.get<Repository<OtjLogEntry>>(getRepositoryToken(OtjLogEntry)),
    );

    const before = new Set(
      (await pendingJobs(digestQueue)).map((job) => job.id),
    );
    await cron.handleDigestCron();
    const queuedByCron = (await pendingJobs(digestQueue)).filter(
      (job) => !before.has(job.id),
    );

    const digestEmails = async (): Promise<Job<IEmailJobPayload>[]> =>
      (await pendingJobs(emailQueue)).filter(
        (job) =>
          job.data.to === manager.email &&
          job.data.template === EmailTemplate.OTJ_WEEKLY_DIGEST,
      );

    const sent: IEmailMessage[] = [];
    const sender = app.get<IEmailSender>(EMAIL_SENDER);
    const spy = jest
      .spyOn(sender, 'send')
      .mockImplementation((message: IEmailMessage) => {
        sent.push(message);
        return Promise.resolve();
      });
    const emailWorker = new EmailSendProcessor(
      app.get(EmailPayloadFactory),
      app.get(EmailService),
    );
    const digestWorker = new DigestProcessor(app.get(OtjDigestService));

    try {
      // The cron found the provider's organisation and queued its job.
      const providerJobs = queuedByCron.filter(
        (job) => job.data.organisationId === providerOrgId,
      );
      expect(providerJobs.map((job) => job.data)).toEqual([
        { organisationId: providerOrgId },
      ]);
      const [digestJob] = providerJobs;

      // ── The digest worker: daily, so due today ────────────────────────────
      await digestWorker.process(digestJob);

      const queuedEmails = await digestEmails();
      expect(queuedEmails).toHaveLength(1);
      const [emailJob] = queuedEmails;
      expect(emailJob.data.context).toEqual(
        expect.objectContaining({
          pendingCount: 1,
          entries: [
            expect.objectContaining({
              apprenticeName: 'Digest Apprentice',
              activityName,
              minutes: 90,
            }),
          ],
        }),
      );

      await emailWorker.process({
        id: emailJob.id,
        name: EMAIL_JOB_SEND,
        data: emailJob.data,
      } as Job<IEmailJobPayload>);
      await emailJob.remove();

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(manager.email);
      expect(sent[0].subject.trim()).not.toBe('');
      expect(sent[0].text).toContain(activityName);
      expect(sent[0].html).toContain(activityName);

      // ── Off: the same job again, and nothing is queued ─────────────────────
      await patch(
        '/api/v1/notifications/preferences/digest',
        manager.accessToken,
      )
        .send({ frequency: 'off' })
        .expect(200);

      await digestWorker.process(digestJob);
      expect(await digestEmails()).toEqual([]);
    } finally {
      spy.mockRestore();
      for (const job of queuedByCron) {
        await job.remove();
      }
      for (const job of await digestEmails()) {
        await job.remove();
      }
    }
  });
});
