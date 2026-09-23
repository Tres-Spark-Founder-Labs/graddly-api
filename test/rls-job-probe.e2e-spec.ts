/* eslint-disable no-console -- a probe; its output is the evidence */
/**
 * Every scheduled job, driven where the real system enters it.
 *
 * ── WHY THIS SUITE EXISTS ───────────────────────────────────────────────────
 *
 * Tenant context is present at the HTTP layer and absent or wrong outside it.
 * A cron has no organisation and no user; a worker has whatever the job
 * payload put in its store. Between 22 and 23 September that cost four
 * silently-dead jobs — the OTJ digest, the levy transfer status sweep, the
 * seven-day commitment chase, and the review reminders before them — each of
 * which logged a clean run for months. Every one was found by driving the job
 * itself, and none by a passing test: the suites that existed entered *below*
 * the layer that was broken, so they were green throughout.
 *
 * So this suite drives the cron methods and the processors, in the contexts
 * the worker gives them, and classifies each one: works, works through a
 * bootstrap window, silently does nothing, or throws. "Silently does nothing"
 * is the class that no dashboard shows and no ordinary test catches.
 *
 * ── WHY IT IS NOT IN THE PER-COMMIT RUN ─────────────────────────────────────
 *
 * It is wired to the batch-boundary run instead — `yarn test:e2e:jobs`, and
 * `yarn test:e2e:all` — and excluded from `test/jest-e2e.json`, the way the
 * OIDC suite is. Three reasons:
 *
 *   - it boots the application twice and seeds two full learner scopes, a
 *     levy-exchange donor context, a commitment statement and a report
 *     subscription, then drives 26 jobs: minutes, not seconds;
 *   - it deliberately writes across most of the schema and deletes what it
 *     wrote, including suspending the append-only trigger on
 *     `audit_log_entries` to clear its own rows. That is safe here and
 *     unnecessary on every push;
 *   - its value is a periodic sweep of "does every job still run in a tenant
 *     context", which changes when a job is added or a policy moves, not on
 *     an average commit.
 *
 * Run it at a batch boundary, when a policy changes, and whenever a cron or
 * processor is added.
 *
 * ── THE THREE PARTS THAT MUST NOT BE DROPPED ────────────────────────────────
 *
 *   1. The role assertion: graddly_app, `rolsuper` and `rolbypassrls` both
 *      false, checked from inside rather than trusted by name.
 *   2. The trigger suspension in cleanup sits in try/finally and asserts the
 *      trigger came back. A suite that can leave an append-only trigger off
 *      after a mid-run failure is a worse risk than the one it guards.
 *   3. The before-and-after row count across every table. That diff is what
 *      makes this safe to run against a database that matters, and it is the
 *      part most likely to look like noise.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';

import {
  QUEUE_DAS_SYNC,
  QUEUE_DAS_SYNC_DLQ,
  QUEUE_DIGEST,
  QUEUE_EMAIL,
  SYSTEM_JOB_PING,
} from '../src/bullmq/bullmq.constants.js';
import { DasSyncProcessor } from '../src/bullmq/processors/das-sync.processor.js';
import { DigestProcessor } from '../src/bullmq/processors/digest.processor.js';
import { EmailSendProcessor } from '../src/bullmq/processors/email-send.processor.js';
import { SystemPingProcessor } from '../src/bullmq/processors/system-ping.processor.js';
import { CommitmentChaseService } from '../src/commitments/commitment-chase.service.js';
import {
  parseEnvFromProcess,
  resetEnvCache,
} from '../src/config/validate-env.js';
import { DAS_CLIENT } from '../src/das/das-client.constants.js';
import { DasFundingSyncService } from '../src/das/das-funding-sync.service.js';
import {
  DAS_JOB_SYNC_FUNDING_PAYMENTS,
  DAS_JOB_SYNC_ORGANISATION,
} from '../src/das/das-job.constants.js';
import { DasLevySyncService } from '../src/das/das-levy-sync.service.js';
import { DasSyncDispatchService } from '../src/das/das-sync-dispatch.service.js';
import { EMAIL_JOB_SEND } from '../src/email/email-job.constants.js';
import { EmailPayloadFactory } from '../src/email/email-payload.factory.js';
import { EmailService } from '../src/email/email.service.js';
import { MilestoneNotificationsService } from '../src/enrolments/milestone-notifications.service.js';
import { RedisHealthIndicator } from '../src/health/redis-health.indicator.js';
import { CaseloadAlertService } from '../src/learners/caseload-alert.service.js';
import { LevyTransfer } from '../src/levy-exchange/entities/levy-transfer.entity.js';
import { LevyExpiryAlertService } from '../src/levy-exchange/services/levy-expiry-alert.service.js';
import { LevyTransferService } from '../src/levy-exchange/services/levy-transfer.service.js';
import { DigestDispatchService } from '../src/notifications/digest-dispatch.service.js';
import { OtjDigestService } from '../src/notifications/otj-digest.service.js';
import { EifScoreSnapshotService } from '../src/ofsted/eif-score-snapshot.service.js';
import { Organisation } from '../src/organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../src/otj/entities/otj-log-entry.entity.js';
import { OtjInactivityService } from '../src/otj/otj-inactivity.service.js';
import { OtjPaceService } from '../src/otj/otj-pace.service.js';
import { PdfJobTemplate } from '../src/pdf/enums/pdf-job-template.enum.js';
import { RedisService } from '../src/redis/redis.service.js';
import { LevyRoiMonthlyReportService } from '../src/reporting/levy-roi-monthly-report.service.js';
import { ReviewsOverdueService } from '../src/reviews/reviews-overdue.service.js';
import { ReviewsReminderService } from '../src/reviews/reviews-reminder.service.js';
import { CaseloadAlertCronService } from '../src/scheduler/caseload-alert-cron.service.js';
import { CommitmentChaseCronService } from '../src/scheduler/commitment-chase-cron.service.js';
import { CronLockService } from '../src/scheduler/cron-lock.service.js';
import { DasFundingSyncCronService } from '../src/scheduler/das-funding-sync-cron.service.js';
import { DasSyncCronService } from '../src/scheduler/das-sync-cron.service.js';
import { DigestCronService } from '../src/scheduler/digest-cron.service.js';
import { EifSnapshotCronService } from '../src/scheduler/eif-snapshot-cron.service.js';
import { HealthCronService } from '../src/scheduler/health-cron.service.js';
import { LevyExpiryAlertsCronService } from '../src/scheduler/levy-expiry-alerts-cron.service.js';
import { LevyRoiMonthlyCronService } from '../src/scheduler/levy-roi-monthly-cron.service.js';
import { LevyTransferStatusCronService } from '../src/scheduler/levy-transfer-status-cron.service.js';
import { MilestoneNotificationsCronService } from '../src/scheduler/milestone-notifications-cron.service.js';
import { OtjInactivityCronService } from '../src/scheduler/otj-inactivity-cron.service.js';
import { OtjPaceCronService } from '../src/scheduler/otj-pace-cron.service.js';
import { ReviewOverdueCronService } from '../src/scheduler/review-overdue-cron.service.js';
import { ReviewRemindersCronService } from '../src/scheduler/review-reminders-cron.service.js';
import { WithdrawalCompletionPush } from '../src/withdrawal-push/entities/withdrawal-completion-push.entity.js';
import { WITHDRAWAL_PUSH_JOB_SEND } from '../src/withdrawal-push/withdrawal-push.constants.js';
import { WithdrawalPushProcessor } from '../src/withdrawal-push/withdrawal-push.processor.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { createLearnerScopeContext } from './helpers/learner-scope-e2e.js';
import {
  createLexOrgContext,
  seedDonorLink,
  seedLinkedDonor,
} from './helpers/levy-exchange-e2e.js';
import { processCompletionPushJobInApp } from './helpers/process-completion-push-job.js';
import { processEnrolmentPushJobInApp } from './helpers/process-enrolment-push-job.js';
import { processEpaPackJobInApp } from './helpers/process-epa-pack-job.js';
import { processEvidencePackJobInApp } from './helpers/process-evidence-pack-job.js';
import { processIlrSubmitJobInApp } from './helpers/process-ilr-submit-job.js';
import { processPdfJobInApp } from './helpers/process-pdf-job.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { App } from 'supertest/types';

type Outcome = {
  job: string;
  ran: string;
  observed: string;
};

const results: Outcome[] = [];

describe('RLS probe: every scheduled job, driven where the real system enters', () => {
  let app: INestApplication<App>;
  let sudo: Client;
  const created = { orgIds: [] as string[], userIds: [] as string[] };
  let countsBefore: Record<string, number>;
  const probeStartedAt = new Date();

  const cronDeps = () =>
    [
      app.get(ConfigService),
      new SchedulerRegistry(),
      new CronLockService(app.get(ConfigService), app.get(RedisService)),
    ] as const;

  const tableCounts = async (): Promise<Record<string, number>> => {
    const tables = await sudo.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations' ORDER BY tablename`,
    );
    const counts: Record<string, number> = {};
    for (const { tablename } of tables.rows) {
      const r = await sudo.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${tablename}"`,
      );
      counts[tablename] = Number(r.rows[0].n);
    }
    return counts;
  };

  /** Runs one job, records what happened, and never fails the probe. */
  const drive = async (
    job: string,
    run: () => Promise<unknown>,
    observe: () => Promise<string>,
  ): Promise<void> => {
    let ran = 'ok';
    try {
      const value = await run();
      ran = value === undefined ? 'ok' : `ok → ${JSON.stringify(value)}`;
    } catch (error) {
      ran = `THREW: ${error instanceof Error ? error.message : String(error)}`;
    }
    let observed: string;
    try {
      observed = await observe();
    } catch (error) {
      observed = `observation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    results.push({ job, ran, observed });
    console.log(`\n### ${job}\n  ran:      ${ran}\n  observed: ${observed}`);
  };

  beforeAll(async () => {
    // The schema's floor is 1, and the rule is "> threshold", so the sweep
    // needs two at-risk learners on one tutor — cheaper than the default 5.
    process.env.CASELOAD_AT_RISK_THRESHOLD = '1';
    resetEnvCache();
    parseEnvFromProcess();

    app = await createE2eApp();
    sudo = createE2ePgClient();
    await sudo.connect();
    countsBefore = await tableCounts();
  }, 300_000);

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
    console.log('\nconnection:', JSON.stringify(row));
    expect(row).toEqual({
      role: 'graddly_app',
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('drives all fifteen cron services', async () => {
    const scope = await createLearnerScopeContext(app, 'rlsprobe');
    created.orgIds.push(scope.providerOrgId, scope.employerOrgId);
    created.userIds.push(
      scope.staffUserId,
      scope.learnerA.userId,
      scope.learnerB.userId,
    );

    // A line manager in the employer organisation only — as production has
    // it, and as the digest fault needed.
    const manager = await createVerifiedUser(app, {
      email: `rlsprobe-manager-${Date.now()}@example.com`,
    });
    created.userIds.push(manager.userId);
    await sudo.query(
      `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [scope.employerOrgId, manager.userId],
    );
    await sudo.query(
      `UPDATE enrolments SET "employerManagerUserId" = $1, "tutorUserId" = $2,
              "employerOrganisationId" = $3
        WHERE id = ANY($4::uuid[])`,
      [
        manager.userId,
        scope.staffUserId,
        scope.employerOrgId,
        [scope.learnerA.enrolmentId, scope.learnerB.enrolmentId],
      ],
    );

    // ── 1. review-overdue: two reviews past their slot ─────────────────────
    await sudo.query(
      `UPDATE reviews SET "scheduledAt" = NOW() - INTERVAL '5 days', status = 'scheduled', "isOverdue" = false WHERE id = $1`,
      [scope.learnerA.reviewId],
    );
    const extraOverdue = await sudo.query<{ id: string }>(
      `INSERT INTO reviews
         ("organisationId", "enrolmentId", "apprenticeId", "scheduledAt", title,
          status, "apprenticeUserId", "tutorUserId", "employerManagerUserId")
       VALUES ($1, $2, $3, NOW() - INTERVAL '6 days', 'rlsprobe-overdue-b',
               'scheduled', $4, $5, $6)
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerB.enrolmentId,
        scope.learnerB.apprenticeId,
        scope.learnerB.userId,
        scope.staffUserId,
        manager.userId,
      ],
    );
    const overdueCron = new ReviewOverdueCronService(
      ...cronDeps(),
      app.get(ReviewsOverdueService),
    );
    await drive(
      'cron: review-overdue',
      () => overdueCron.handleReviewOverdueCron(),
      async () => {
        const r = await sudo.query<{ id: string; isOverdue: boolean }>(
          `SELECT id, "isOverdue" FROM reviews WHERE id = ANY($1::uuid[])`,
          [[scope.learnerA.reviewId, extraOverdue.rows[0].id]],
        );
        return `isOverdue flags = [${r.rows.map((x) => x.isOverdue).join(', ')}] (2 reviews were past due)`;
      },
    );

    // ── 2. review-reminders: the other review 48 hours out ─────────────────
    await sudo.query(
      `UPDATE reviews SET "scheduledAt" = NOW() + INTERVAL '48 hours', status = 'scheduled' WHERE id = $1`,
      [scope.learnerB.reviewId],
    );
    const remindersCron = new ReviewRemindersCronService(
      ...cronDeps(),
      app.get(ReviewsReminderService),
    );
    await drive(
      'cron: review-reminders',
      () => remindersCron.handleReviewRemindersCron(),
      async () => {
        const d = await sudo.query<{ reminderKind: string }>(
          `SELECT "reminderKind" FROM review_reminder_dispatches WHERE "reviewId" = $1`,
          [scope.learnerB.reviewId],
        );
        const n = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM notifications WHERE "organisationId" = $1 AND type = 'review'`,
          [scope.providerOrgId],
        );
        return `dispatches = [${d.rows.map((x) => x.reminderKind).join(', ')}], review notifications = ${n.rows[0].n}`;
      },
    );

    // ── 3. caseload-alert: the overdue review makes learnerA at-risk ───────
    const caseloadCron = new CaseloadAlertCronService(
      ...cronDeps(),
      app.get(CaseloadAlertService),
    );
    await drive(
      'cron: caseload-alert',
      () => caseloadCron.handleCaseloadAlertCron(),
      async () => {
        const n = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM notifications WHERE "organisationId" = $1 AND type = 'caseload_at_risk'`,
          [scope.providerOrgId],
        );
        return `caseload_at_risk notifications = ${n.rows[0].n}`;
      },
    );

    // ── 4. otj-pace: planned dates and a duration, so pace has a verdict ───
    await sudo.query(
      `UPDATE enrolments
          SET "plannedDurationMonths" = 12,
              "plannedStartDate" = (NOW() - INTERVAL '6 months')::date,
              "plannedEndDate" = (NOW() + INTERVAL '6 months')::date
        WHERE id = ANY($1::uuid[])`,
      [[scope.learnerA.enrolmentId, scope.learnerB.enrolmentId]],
    );
    const paceSql = `SELECT id, "otjPaceAlertLevel" AS level, "otjBehindPercent" AS pct,
              ("otjPaceAlertedAt" IS NOT NULL) AS alerted
         FROM enrolments WHERE id = ANY($1::uuid[]) ORDER BY id`;
    type PaceRow = {
      id: string;
      level: string | null;
      pct: string | null;
      alerted: boolean;
    };
    const paceBefore = await sudo.query<PaceRow>(paceSql, [
      [scope.learnerA.enrolmentId, scope.learnerB.enrolmentId],
    ]);
    const paceCron = new OtjPaceCronService(
      ...cronDeps(),
      app.get(OtjPaceService),
    );
    await drive(
      'cron: otj-pace',
      () => paceCron.handleOtjPaceCron(),
      async () => {
        const after = await sudo.query<PaceRow>(paceSql, [
          [scope.learnerA.enrolmentId, scope.learnerB.enrolmentId],
        ]);
        const show = (rows: PaceRow[]) =>
          rows
            .map(
              (r) =>
                `${r.level ?? 'null'}/${r.pct ?? 'null'}%/${r.alerted ? 'alerted' : 'not alerted'}`,
            )
            .join(', ');
        return `level/behind%/alerted before = [${show(paceBefore.rows)}], after = [${show(after.rows)}]`;
      },
    );

    // ── 5. otj-inactivity: backdate the entries so both learners are quiet ─
    await sudo.query(
      `UPDATE otj_log_entries SET "createdAt" = NOW() - INTERVAL '60 days' WHERE "organisationId" = $1`,
      [scope.providerOrgId],
    );
    const inactivityCron = new OtjInactivityCronService(
      ...cronDeps(),
      app.get(OtjInactivityService),
    );
    await drive(
      'cron: otj-inactivity',
      () => inactivityCron.handleOtjInactivityCron(),
      async () => {
        const n = await sudo.query<{ type: string; n: string }>(
          `SELECT type, count(*) AS n FROM notifications
            WHERE "userId" = ANY($1::uuid[]) GROUP BY type`,
          [[scope.learnerA.userId, scope.learnerB.userId]],
        );
        return `learner notifications = [${n.rows.map((r) => `${r.type}:${r.n}`).join(', ')}]`;
      },
    );

    // ── 6. digest ──────────────────────────────────────────────────────────
    const digestQueue = app.get(getQueueToken(QUEUE_DIGEST));
    const digestCron = new DigestCronService(
      ...cronDeps(),
      app.get(DigestDispatchService),
      app.get<Repository<OtjLogEntry>>(getRepositoryToken(OtjLogEntry)),
    );
    await drive(
      'cron: digest',
      () => digestCron.handleDigestCron(),
      async () => {
        const jobs = await digestQueue.getJobs([
          'waiting',
          'delayed',
          'prioritized',
          'paused',
        ]);
        const mine = jobs.filter(
          (j: { data: { organisationId: string } }) =>
            j.data.organisationId === scope.providerOrgId,
        );
        return `digest jobs for the provider = ${mine.length}`;
      },
    );

    // ── 7 + 8. das-sync and das-funding-sync ───────────────────────────────
    const dasQueue = app.get(getQueueToken(QUEUE_DAS_SYNC));
    const dasSyncCron = new DasSyncCronService(
      ...cronDeps(),
      app.get(DasSyncDispatchService),
      app.get<Repository<Organisation>>(getRepositoryToken(Organisation)),
    );
    await drive(
      'cron: das-sync',
      () => dasSyncCron.handleDasSyncCron(),
      async () => {
        const jobs = await dasQueue.getJobs([
          'waiting',
          'delayed',
          'prioritized',
          'paused',
        ]);
        const mine = jobs.filter(
          (j: { name: string; data: { organisationId: string } }) =>
            j.name === DAS_JOB_SYNC_ORGANISATION &&
            created.orgIds.includes(j.data.organisationId),
        );
        return `das-sync jobs for the probe's orgs = ${mine.length} of ${jobs.length} on the queue`;
      },
    );

    // Funding sync shares the das-sync queue under a different job name.
    const fundingCron = new DasFundingSyncCronService(
      ...cronDeps(),
      app.get(DasSyncDispatchService),
      app.get<Repository<Organisation>>(getRepositoryToken(Organisation)),
    );
    await drive(
      'cron: das-funding-sync',
      () => fundingCron.handleFundingSyncCron(),
      async () => {
        const jobs = await dasQueue.getJobs([
          'waiting',
          'delayed',
          'prioritized',
          'paused',
        ]);
        const mine = jobs.filter(
          (j: { name: string; data: { organisationId: string } }) =>
            j.name === DAS_JOB_SYNC_FUNDING_PAYMENTS &&
            created.orgIds.includes(j.data.organisationId),
        );
        return `funding-sync jobs for the probe's orgs = ${mine.length} of ${jobs.length} queued`;
      },
    );

    // ── 9. eif-snapshot ────────────────────────────────────────────────────
    const eifCron = new EifSnapshotCronService(
      ...cronDeps(),
      app.get(EifScoreSnapshotService),
    );
    await drive(
      'cron: eif-snapshot',
      () => eifCron.handleEifSnapshotCron(),
      async () => {
        const r = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM eif_score_snapshots WHERE "organisationId" = $1`,
          [scope.providerOrgId],
        );
        return `snapshots for the provider = ${r.rows[0].n}`;
      },
    );

    // ── 10. commitment-chase ───────────────────────────────────────────────
    const group = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_statement_groups ("organisationId", "enrolmentId", "apprenticeId")
       VALUES ($1, $2, $3) RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.enrolmentId,
        scope.learnerA.apprenticeId,
      ],
    );
    const statement = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_statements
         ("organisationId", "groupId", version, status, content,
          "apprenticeUserId", "tutorUserId", "employerManagerUserId", "createdAt")
       VALUES ($1, $5, 1, 'awaiting_signatures', '{}'::jsonb,
               $2, $3, $4, NOW() - INTERVAL '10 days')
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.userId,
        scope.staffUserId,
        manager.userId,
        group.rows[0].id,
      ],
    );
    const signature = await sudo.query<{ id: string }>(
      `INSERT INTO commitment_signatures
         ("organisationId", "statementId", party, "signOrder", "signerUserId", status, "createdAt")
       VALUES ($1, $2, 'apprentice', 1, $3, 'pending', NOW() - INTERVAL '10 days')
       RETURNING id`,
      [scope.providerOrgId, statement.rows[0].id, scope.learnerA.userId],
    );
    const chaseCron = new CommitmentChaseCronService(
      ...cronDeps(),
      app.get(CommitmentChaseService),
    );
    await drive(
      'cron: commitment-chase',
      () => chaseCron.handleCommitmentChaseCron(),
      async () => {
        const n = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM notifications
            WHERE "userId" = $1 AND type = 'commitment'`,
          [scope.learnerA.userId],
        );
        const d = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM commitment_chase_dispatches WHERE "signatureId" = $1`,
          [signature.rows[0].id],
        );
        return `commitment notifications = ${n.rows[0].n}, chase dispatches = ${d.rows[0].n} (statement is 10 days unsigned)`;
      },
    );

    // ── 11 + 12. levy: expiry alerts and transfer status ───────────────────
    const lex = await createLexOrgContext(app, 'rlsprobe-lex');
    created.orgIds.push(lex.orgId);
    created.userIds.push(lex.user.userId);
    const { linkId } = await seedDonorLink(app, lex, { label: 'Probe HQ' });
    await seedLinkedDonor(app, lex, linkId);
    const in90 = new Date();
    in90.setUTCHours(0, 0, 0, 0);
    in90.setUTCDate(in90.getUTCDate() + 90);
    await sudo.query(
      `INSERT INTO das_levy_tranches ("organisationId", "donorLinkId", amount, "expiresOn")
       VALUES ($1, $2, '9100.00', $3)`,
      [lex.orgId, linkId, in90.toISOString().slice(0, 10)],
    );

    const expiryCron = new LevyExpiryAlertsCronService(
      ...cronDeps(),
      app.get(LevyExpiryAlertService),
    );
    await drive(
      'cron: levy-expiry-alerts',
      () => expiryCron.handleLevyExpiryAlertsCron(),
      async () => {
        const d = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM levy_expiry_alert_dispatches WHERE "organisationId" = $1`,
          [lex.orgId],
        );
        const n = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM notifications WHERE "organisationId" = $1 AND type::text LIKE 'levy_expiry%'`,
          [lex.orgId],
        );
        return `dispatches = ${d.rows[0].n}, notifications = ${n.rows[0].n}`;
      },
    );

    const transfer = await sudo.query<{ id: string }>(
      `INSERT INTO levy_transfers
         ("donorOrganisationId", "recipientOrganisationId", amount, status, "esfaTransferReference")
       VALUES ($1, $2, '5000.00', 'confirmed', 'PROBE-TRANSFER-REF')
       RETURNING id`,
      [lex.orgId, scope.employerOrgId],
    );
    // The ESFA call is the one double: the probe is about tenant context, and
    // .env.test points DAS at an unreachable host.
    const dasClient = app.get<{
      fetchTransferStatus: (...args: unknown[]) => Promise<unknown>;
    }>(DAS_CLIENT);
    dasClient.fetchTransferStatus = () =>
      Promise.resolve({
        reference: 'PROBE-TRANSFER-REF',
        status: 'active',
        amountsReleased: null,
        paymentDates: null,
        raw: { status: 'active', probe: true },
      });
    const transferCron = new LevyTransferStatusCronService(
      ...cronDeps(),
      app.get(LevyTransferService),
      app.get<Repository<LevyTransfer>>(getRepositoryToken(LevyTransfer)),
    );
    await drive(
      'cron: levy-transfer-status',
      () => transferCron.handleLevyTransferStatusCron(),
      async () => {
        const r = await sudo.query<{ status: string; payload: unknown }>(
          `SELECT status, "dasStatusPayload" AS payload FROM levy_transfers WHERE id = $1`,
          [transfer.rows[0].id],
        );
        return `transfer status = ${r.rows[0].status}, dasStatusPayload = ${JSON.stringify(r.rows[0].payload)}`;
      },
    );

    // ── 13. levy-roi-monthly ───────────────────────────────────────────────
    await sudo.query(
      `INSERT INTO report_subscriptions ("organisationId", "userId", "reportType", enabled)
       VALUES ($1, $2, 'levy_roi_monthly', true)`,
      [scope.employerOrgId, manager.userId],
    );
    const emailQueue = app.get(getQueueToken(QUEUE_EMAIL));
    const roiCron = new LevyRoiMonthlyCronService(
      ...cronDeps(),
      app.get(LevyRoiMonthlyReportService),
    );
    await drive(
      'cron: levy-roi-monthly',
      () => roiCron.handleLevyRoiMonthlyCron(),
      async () => {
        const jobs = await emailQueue.getJobs([
          'waiting',
          'delayed',
          'prioritized',
          'paused',
        ]);
        const mine = jobs.filter(
          (j: { data: { to: string; template: string } }) =>
            j.data.to === manager.email,
        );
        const s = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM report_subscriptions WHERE "organisationId" = $1 AND "lastSentAt" IS NOT NULL`,
          [scope.employerOrgId],
        );
        return `email jobs to the subscriber = [${mine.map((j: { data: { template: string } }) => j.data.template).join(', ')}], subscriptions marked sent = ${s.rows[0].n}`;
      },
    );

    // ── 14. health ─────────────────────────────────────────────────────────
    const healthCron = new HealthCronService(
      app.get(ConfigService),
      app.get(HealthCheckService),
      await app.resolve(TypeOrmHealthIndicator),
      await app.resolve(RedisHealthIndicator),
      new SchedulerRegistry(),
      new CronLockService(app.get(ConfigService), app.get(RedisService)),
    );
    await drive(
      'cron: health',
      () => healthCron.handleHealthCheckCron(),
      () => Promise.resolve('no tenant table read; DB ping + Redis ping only'),
    );

    // ── 15. milestone-notifications ────────────────────────────────────────
    /**
     * Driven twice, because one run proves nothing here. The first observes
     * the scope and records what is already complete *without* sending —
     * that is the rule that stops shipping the sweep announcing months of
     * history. The learner's review is then held, and the second run is the
     * one that has to announce. An emitter that only ever seeds looks busy in
     * its marker table and reaches nobody, which is exactly the class of
     * fault this probe exists to catch.
     */
    const milestoneCron = new MilestoneNotificationsCronService(
      ...cronDeps(),
      app.get(MilestoneNotificationsService),
    );
    await milestoneCron.handleMilestoneNotificationsCron();
    await sudo.query(`UPDATE reviews SET status = 'completed' WHERE id = $1`, [
      scope.learnerA.reviewId,
    ]);
    await drive(
      'cron: milestone-notifications',
      () => milestoneCron.handleMilestoneNotificationsCron(),
      async () => {
        const m = await sudo.query<{ milestoneKey: string; outcome: string }>(
          `SELECT "milestoneKey", outcome FROM enrolment_milestone_notifications
            WHERE "enrolmentId" = $1 ORDER BY outcome, "milestoneKey"`,
          [scope.learnerA.enrolmentId],
        );
        const n = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM notifications
            WHERE "userId" = $1 AND type = 'milestone_completed'`,
          [scope.learnerA.userId],
        );
        return `markers = [${m.rows
          .map((r) => `${r.milestoneKey}=${r.outcome}`)
          .join(', ')}], milestone_completed notifications = ${n.rows[0].n}`;
      },
    );

    console.log(`\n=== cron summary ===\n${JSON.stringify(results, null, 2)}`);
  }, 900_000);

  it('drives all eleven processors', async () => {
    const scope = await createLearnerScopeContext(app, 'rlsprobe-proc');
    created.orgIds.push(scope.providerOrgId, scope.employerOrgId);
    created.userIds.push(
      scope.staffUserId,
      scope.learnerA.userId,
      scope.learnerB.userId,
    );
    const manager = await createVerifiedUser(app, {
      email: `rlsprobe-proc-manager-${Date.now()}@example.com`,
    });
    created.userIds.push(manager.userId);
    await sudo.query(
      `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [scope.employerOrgId, manager.userId],
    );
    await sudo.query(
      `UPDATE enrolments SET "employerManagerUserId" = $1, "employerOrganisationId" = $2
        WHERE id = ANY($3::uuid[])`,
      [
        manager.userId,
        scope.employerOrgId,
        [scope.learnerA.enrolmentId, scope.learnerB.enrolmentId],
      ],
    );

    // The ESFA is the only double in this half: what is under test is the
    // tenant context each job runs its reads and writes in.
    const dasClient = app.get<Record<string, unknown>>(DAS_CLIENT);
    dasClient.fetchLevyBalance = () =>
      Promise.resolve({
        accountId: 'probe-account',
        balance: '4242.00',
        currency: 'GBP',
        raw: { probe: true, tranches: [] },
      });
    dasClient.fetchFundingPayments = () =>
      Promise.resolve([
        {
          externalReference: 'probe-fp-1',
          paymentDate: '2026-02-01',
          amount: '1000.00',
          currency: 'GBP',
          fundingPeriod: '2025-26',
          clawbackNotice: null,
          learnerRef: null,
          raw: { reference: 'probe-fp-1' },
        },
      ]);
    dasClient.submitEnrolment = () =>
      Promise.resolve({ reference: 'PROBE-ENROLMENT-REF', raw: { ok: true } });
    dasClient.notifyCompletion = () =>
      Promise.resolve({ reference: 'PROBE-COMPLETION-REF', raw: { ok: true } });

    // ── 1 + 2. das-sync: both job names on that queue ──────────────────────
    const dasProcessor = new DasSyncProcessor(
      app.get(DasLevySyncService),
      app.get(DasFundingSyncService),
      app.get(getQueueToken(QUEUE_DAS_SYNC_DLQ)),
      app.get(ConfigService),
    );
    await drive(
      'processor: das-sync (sync-organisation)',
      () =>
        dasProcessor.process({
          id: 'probe-das-1',
          name: DAS_JOB_SYNC_ORGANISATION,
          data: {
            organisationId: scope.employerOrgId,
            requestedByUserId: manager.userId,
          },
        } as never),
      async () => {
        const r = await sudo.query<{ balance: string; status: string }>(
          `SELECT balance, "lastSyncStatus" AS status FROM das_levy_balances WHERE "organisationId" = $1`,
          [scope.employerOrgId],
        );
        return `levy balance rows = ${JSON.stringify(r.rows)}`;
      },
    );
    await drive(
      'processor: das-sync (sync-funding-payments)',
      () =>
        dasProcessor.process({
          id: 'probe-das-2',
          name: DAS_JOB_SYNC_FUNDING_PAYMENTS,
          data: {
            organisationId: scope.employerOrgId,
            requestedByUserId: manager.userId,
          },
        } as never),
      async () => {
        const r = await sudo.query<{ n: string }>(
          `SELECT count(*) AS n FROM das_funding_payments WHERE "organisationId" = $1`,
          [scope.employerOrgId],
        );
        return `funding payment rows = ${r.rows[0].n}`;
      },
    );

    // ── 3. digest: the job the cron queues, taken off the real queue ───────
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences/digest')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ frequency: 'daily' })
      .expect(200);
    const digestQueue = app.get(getQueueToken(QUEUE_DIGEST));
    const digestCron = new DigestCronService(
      ...cronDeps(),
      app.get(DigestDispatchService),
      app.get<Repository<OtjLogEntry>>(getRepositoryToken(OtjLogEntry)),
    );
    await digestCron.handleDigestCron();
    const digestJobs = await digestQueue.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'paused',
    ]);
    const digestJob = digestJobs.find(
      (j: { data: { organisationId: string } }) =>
        j.data.organisationId === scope.providerOrgId,
    );
    const digestWorker = new DigestProcessor(app.get(OtjDigestService));
    const emailQueue = app.get(getQueueToken(QUEUE_EMAIL));
    await drive(
      'processor: digest',
      () => digestWorker.process(digestJob as never),
      async () => {
        const jobs = await emailQueue.getJobs([
          'waiting',
          'delayed',
          'prioritized',
          'paused',
        ]);
        const mine = jobs.filter(
          (j: { data: { to: string; template: string } }) =>
            j.data.to === manager.email &&
            j.data.template === 'otj-weekly-digest',
        );
        return `digest email jobs for the manager = ${mine.length} (job taken off the digest queue: ${digestJob ? 'yes' : 'NO JOB FOUND'})`;
      },
    );

    // ── 4. email-send ──────────────────────────────────────────────────────
    const emailWorker = new EmailSendProcessor(
      app.get(EmailPayloadFactory),
      app.get(EmailService),
    );
    await drive(
      'processor: email-send',
      () =>
        emailWorker.process({
          id: 'probe-email',
          name: EMAIL_JOB_SEND,
          data: {
            template: 'otj-weekly-digest',
            to: manager.email,
            context: {
              firstName: 'Probe',
              pendingCount: 1,
              entries: [
                {
                  apprenticeName: 'A Learner',
                  loggedDate: '2026-01-01',
                  minutes: 60,
                  category: 'other',
                  activityName: 'probe',
                },
              ],
              appName: 'Graddly',
            },
          },
        } as never),
      () =>
        Promise.resolve(
          'rendered and handed to the noop sender; no repository in this path',
        ),
    );

    // ── 5. system-ping ─────────────────────────────────────────────────────
    await drive(
      'processor: system-ping',
      () =>
        new SystemPingProcessor().process({
          id: 'probe-ping',
          name: SYSTEM_JOB_PING,
          data: {},
        } as never),
      () => Promise.resolve('logs only; no database access'),
    );

    // ── 6. pdf-generation ──────────────────────────────────────────────────
    const pdfJob = await sudo.query<{ id: string }>(
      `INSERT INTO pdf_generation_jobs ("organisationId", "requestedByUserId", template, status)
       VALUES ($1, $2, 'apprentice_roster', 'queued') RETURNING id`,
      [scope.employerOrgId, manager.userId],
    );
    await drive(
      'processor: pdf-generation',
      () =>
        processPdfJobInApp(app, {
          jobId: pdfJob.rows[0].id,
          organisationId: scope.employerOrgId,
          userId: manager.userId,
          template: PdfJobTemplate.APPRENTICE_ROSTER,
        }),
      async () => {
        const r = await sudo.query<{ status: string; key: string | null }>(
          `SELECT status, "outputKey" AS key FROM pdf_generation_jobs WHERE id = $1`,
          [pdfJob.rows[0].id],
        );
        return `pdf job = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 7. epa-pack ────────────────────────────────────────────────────────
    const epaJob = await sudo.query<{ id: string }>(
      `INSERT INTO epa_pack_jobs ("organisationId", "enrolmentId", "requestedByUserId", status)
       VALUES ($1, $2, $3, 'queued') RETURNING id`,
      [scope.providerOrgId, scope.learnerA.enrolmentId, scope.staffUserId],
    );
    await drive(
      'processor: epa-pack',
      () =>
        processEpaPackJobInApp(app, {
          jobId: epaJob.rows[0].id,
          organisationId: scope.providerOrgId,
          userId: scope.staffUserId,
          enrolmentId: scope.learnerA.enrolmentId,
        }),
      async () => {
        const r = await sudo.query<{
          status: string;
          key: string | null;
          emailed: string | null;
        }>(
          `SELECT status, "outputKey" AS key, "downloadEmailSentAt" AS emailed FROM epa_pack_jobs WHERE id = $1`,
          [epaJob.rows[0].id],
        );
        return `epa pack job = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 8. evidence-pack ───────────────────────────────────────────────────
    const evidenceJob = await sudo.query<{ id: string }>(
      `INSERT INTO evidence_pack_jobs ("organisationId", "requestedByUserId", status)
       VALUES ($1, $2, 'queued') RETURNING id`,
      [scope.providerOrgId, scope.staffUserId],
    );
    await drive(
      'processor: evidence-pack',
      () =>
        processEvidencePackJobInApp(app, {
          jobId: evidenceJob.rows[0].id,
          organisationId: scope.providerOrgId,
          userId: scope.staffUserId,
        }),
      async () => {
        const r = await sudo.query<{ status: string; key: string | null }>(
          `SELECT status, "outputKey" AS key FROM evidence_pack_jobs WHERE id = $1`,
          [evidenceJob.rows[0].id],
        );
        return `evidence pack job = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 9. enrolment-push ──────────────────────────────────────────────────
    const learnerRecord = await sudo.query<{ id: string }>(
      `INSERT INTO ilr_learner_records
         ("organisationId", "enrolmentId", "apprenticeId", "collectionPeriod",
          "academicYear", "mappingConfigId", "mappingConfigVersion", status, fields, "manualOverrides")
       SELECT $1, $2, $3, '2025-12', '2025-26', c.id, c.version, 'validated', '{}'::jsonb, '{}'::jsonb
         FROM ilr_mapping_configs c WHERE c."academicYear" = '2025-26' AND c.version = 1
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.enrolmentId,
        scope.learnerA.apprenticeId,
      ],
    );
    const enrolmentPush = await sudo.query<{ id: string }>(
      `INSERT INTO enrolment_submission_pushes
         ("organisationId", "enrolmentId", "apprenticeId", "ilrLearnerRecordId", trigger, status, payload)
       VALUES ($1, $2, $3, $4, 'ilr_created', 'queued', $5::jsonb)
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.enrolmentId,
        scope.learnerA.apprenticeId,
        learnerRecord.rows[0].id,
        JSON.stringify({
          ukprn: '10000001',
          learnerRef: 'PROBELEARNER1',
          standardCode: 'ST0001',
          givenNames: 'Probe',
          familyName: 'Learner',
          plannedStartDate: '2026-01-01',
          plannedEndDate: '2026-12-31',
        }),
      ],
    );
    await drive(
      'processor: enrolment-push',
      () =>
        processEnrolmentPushJobInApp(app, {
          pushId: enrolmentPush.rows[0].id,
          organisationId: scope.providerOrgId,
          requestedByUserId: scope.staffUserId,
        }),
      async () => {
        const r = await sudo.query<{ status: string; ref: string | null }>(
          `SELECT status, "dasReference" AS ref FROM enrolment_submission_pushes WHERE id = $1`,
          [enrolmentPush.rows[0].id],
        );
        return `enrolment push = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 10. completion-push ────────────────────────────────────────────────
    const completionPush = await sudo.query<{ id: string }>(
      `INSERT INTO enrolment_completion_pushes
         ("organisationId", "enrolmentId", "apprenticeId", trigger, status, payload)
       VALUES ($1, $2, $3, 'epa_outcome_recorded', 'queued', $4::jsonb)
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.enrolmentId,
        scope.learnerA.apprenticeId,
        JSON.stringify({
          ukprn: '10000001',
          learnerRef: 'PROBELEARNER1',
          completionDate: '2026-09-01',
          outcome: 'pass',
        }),
      ],
    );
    await drive(
      'processor: completion-push',
      () =>
        processCompletionPushJobInApp(app, {
          pushId: completionPush.rows[0].id,
          organisationId: scope.providerOrgId,
          requestedByUserId: scope.staffUserId,
        }),
      async () => {
        const r = await sudo.query<{ status: string; ref: string | null }>(
          `SELECT status, "dasReference" AS ref FROM enrolment_completion_pushes WHERE id = $1`,
          [completionPush.rows[0].id],
        );
        return `completion push = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 11. withdrawal-push ────────────────────────────────────────────────
    const withdrawalPush = await sudo.query<{ id: string }>(
      `INSERT INTO withdrawal_completion_pushes
         ("organisationId", "enrolmentId", "apprenticeId", status, payload)
       VALUES ($1, $2, $3, 'queued', '{"probe": true}'::jsonb)
       RETURNING id`,
      [
        scope.providerOrgId,
        scope.learnerA.enrolmentId,
        scope.learnerA.apprenticeId,
      ],
    );
    const withdrawalWorker = new WithdrawalPushProcessor(
      app.get(ConfigService),
      app.get<Repository<WithdrawalCompletionPush>>(
        getRepositoryToken(WithdrawalCompletionPush),
      ),
    );
    await drive(
      'processor: withdrawal-push',
      () =>
        withdrawalWorker.process({
          id: withdrawalPush.rows[0].id,
          name: WITHDRAWAL_PUSH_JOB_SEND,
          data: {
            pushId: withdrawalPush.rows[0].id,
            organisationId: scope.providerOrgId,
            requestedByUserId: scope.staffUserId,
          },
          opts: { attempts: 3 },
          attemptsMade: 0,
        } as never),
      async () => {
        const r = await sudo.query<{ status: string; err: string | null }>(
          `SELECT status, "lastError" AS err FROM withdrawal_completion_pushes WHERE id = $1`,
          [withdrawalPush.rows[0].id],
        );
        return `withdrawal push = ${JSON.stringify(r.rows[0])}`;
      },
    );

    // ── 12. ilr-submit ─────────────────────────────────────────────────────
    const submission = await sudo.query<{ id: string }>(
      `INSERT INTO ilr_submissions
         ("organisationId", "ilrLearnerRecordId", attempt, status, "isAmendment", "requestedByUserId")
       VALUES ($1, $2, 1, 'queued', false, $3) RETURNING id`,
      [scope.providerOrgId, learnerRecord.rows[0].id, scope.staffUserId],
    );
    await drive(
      'processor: ilr-submit',
      () =>
        processIlrSubmitJobInApp(app, {
          submissionId: submission.rows[0].id,
          organisationId: scope.providerOrgId,
          requestedByUserId: scope.staffUserId,
        }),
      async () => {
        const r = await sudo.query<{ status: string; ref: string | null }>(
          `SELECT status, "esfaReference" AS ref FROM ilr_submissions WHERE id = $1`,
          [submission.rows[0].id],
        );
        return `ilr submission = ${JSON.stringify(r.rows[0])}`;
      },
    );

    console.log(`\n=== full summary ===\n${JSON.stringify(results, null, 2)}`);
  }, 900_000);

  it('cleans up, restores the append-only trigger, and leaves no rows behind', async () => {
    /**
     * `audit_log_entries` refuses DELETE and UPDATE through an append-only
     * trigger, and the cascade from organisations and users is an
     * `ON DELETE SET NULL` the same trigger refuses. So the probe's own audit
     * rows are cleared with the trigger suspended.
     *
     * The suspension is in try/finally, and the finally asserts the trigger
     * is enabled again: a failure part-way through cleanup must not leave the
     * audit trail writable. That is a worse outcome than the rows this
     * cleanup exists to remove.
     */
    try {
      await sudo.query(
        `ALTER TABLE audit_log_entries DISABLE TRIGGER audit_log_entries_immutable_trigger`,
      );
      await sudo.query(
        `DELETE FROM audit_log_entries WHERE "organisationId" = ANY($1::uuid[]) OR "actorUserId" = ANY($2::uuid[])`,
        [created.orgIds, created.userIds],
      );
      await sudo.query(`DELETE FROM organisations WHERE id = ANY($1::uuid[])`, [
        created.orgIds,
      ]);
      await sudo.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
        created.userIds,
      ]);
      await sudo.query(
        `DELETE FROM users WHERE email LIKE '%rlsprobe%' OR email LIKE '%scope-%rlsprobe%'`,
      );
      await sudo.query(
        `DELETE FROM organisations WHERE name LIKE '%rlsprobe%' OR slug LIKE '%rlsprobe%'`,
      );

      await sudo.query(
        `DELETE FROM audit_log_entries WHERE "organisationId" IS NULL AND "createdAt" >= $1`,
        [probeStartedAt],
      );
      // Rows whose organisation FK does not cascade.
      for (const table of [
        'eif_score_snapshots',
        'safeguarding_checklist_items',
      ]) {
        await sudo.query(`DELETE FROM "${table}" WHERE "createdAt" >= $1`, [
          probeStartedAt,
        ]);
      }
    } finally {
      await sudo.query(
        `ALTER TABLE audit_log_entries ENABLE TRIGGER audit_log_entries_immutable_trigger`,
      );
      const triggerBack = await sudo.query<{ enabled: string }>(
        `SELECT tgenabled AS enabled FROM pg_trigger
          WHERE tgrelid = 'audit_log_entries'::regclass
            AND tgname = 'audit_log_entries_immutable_trigger'`,
      );
      console.log(
        `append-only trigger re-enabled: ${triggerBack.rows[0]?.enabled === 'O'}`,
      );
      // 'O' is "enabled, origin sessions" — the default. Asserted, not
      // logged and hoped for.
      expect(triggerBack.rows[0]?.enabled).toBe('O');
    }

    const after = await tableCounts();
    const diff = Object.entries(after)
      .map(([table, n]) => [table, n - (countsBefore[table] ?? 0)] as const)
      .filter(([, delta]) => delta !== 0);
    console.log(
      `\n=== rows left behind ===\n${diff.length === 0 ? 'none' : JSON.stringify(Object.fromEntries(diff), null, 2)}`,
    );
    /**
     * Every table's row count, before the fixtures and after the cleanup.
     *
     * The probe writes through the application over a connection pool, so a
     * single transaction cannot hold it and there is nothing to roll back.
     * This identity is the substitute, and it is what makes the suite safe to
     * point at a database that matters: if anything the probe wrote survives
     * — a notification, an audit row, a dispatch — this fails and names the
     * table.
     */
    expect(Object.fromEntries(diff)).toEqual({});
  }, 300_000);
});
