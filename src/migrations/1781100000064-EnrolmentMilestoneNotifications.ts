import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.4.3 AC2 — `milestone_completed`, the one declared notification type that
 * nothing emitted.
 *
 * ── WHY A MARKER TABLE AND NOT MILESTONE STATE ──────────────────────────────
 *
 * Journey milestones are derived on every read (`buildMilestones`), which is a
 * client decision: late, rescheduled and missed reviews then show as they
 * really are. Storing milestone status would put a conclusion next to its own
 * inputs — `activatedAt`, each review's `status`, `gatewayReadyAt`,
 * `completedAt` — and commit us to keeping the two in agreement forever.
 *
 * So this table stores only what the derivation cannot: whether we have
 * already told the apprentice about a milestone. One row per enrolment per
 * milestone, and nothing in it is read by the API.
 *
 * ── THE KEY IS NOT THE MILESTONE CODE ───────────────────────────────────────
 *
 * The codes in the API response are positional: `review_1`, `review_2` … are
 * assigned by `scheduledAt` order at read time, so inserting a rescheduled
 * review earlier silently reassigns them. A marker keyed on the code would
 * follow the wrong review the first time a learner rescheduled. `milestoneKey`
 * is therefore `enrolment`, `induction`, `gateway`, `epa`, `completion`, or
 * `review:<reviewId>` — stable for the life of the row.
 *
 * ── WHAT A ROW MEANS, AND WHY THE CHECK CONSTRAINT IS HERE ──────────────────
 *
 *   outcome = 'notified'  — we sent it, once, at `notifiedAt`.
 *   outcome = 'seeded'    — accounted for without sending, with the reason in
 *                           `reason`: it was already complete when the sweep
 *                           first looked at this enrolment, or it is the
 *                           learner's own enrolment moment.
 *
 * There is deliberately no third state for "claimed but not yet sent". A
 * claim written before delivery is what turned six emitters into permanent
 * silence last week: the row suppressed every later attempt and the thing was
 * never sent. Here the row is written only once a channel has landed, so a
 * failed send leaves no row and the next sweep tries again. The check
 * constraint keeps those two meanings from collapsing into one nullable
 * column: `notifiedAt` is set exactly when `outcome = 'notified'`.
 *
 * `enrolments.milestonesObservedAt` is the sweep's own first-look stamp, the
 * same kind of fact as `gatewayReadyNotifiedAt` beside it. Without it, an
 * enrolment with nothing complete yet would be indistinguishable from one the
 * sweep had never seen, and its first completion would be seeded in silence
 * instead of sent.
 */
export class EnrolmentMilestoneNotifications1781100000064 implements MigrationInterface {
  name = 'EnrolmentMilestoneNotifications1781100000064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "enrolment_milestone_notification_outcome" AS ENUM ('seeded', 'notified')`,
    );
    await queryRunner.query(
      `CREATE TABLE "enrolment_milestone_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "milestoneKey" character varying(80) NOT NULL,
        "outcome" "enrolment_milestone_notification_outcome" NOT NULL,
        "completedOn" date,
        "notifiedAt" TIMESTAMP WITH TIME ZONE,
        "reason" text,
        CONSTRAINT "PK_enrolment_milestone_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_enrolment_milestone_notifications_notified_at"
          CHECK (("outcome" = 'notified') = ("notifiedAt" IS NOT NULL))
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_milestone_notifications" ADD CONSTRAINT "FK_enrolment_milestone_notifications_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_milestone_notifications" ADD CONSTRAINT "FK_enrolment_milestone_notifications_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // One row per milestone per enrolment: the backstop for a double send if
    // two sweeps ever overlap, as well as the "already accounted for" lookup.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_enrolment_milestone_notifications_enrolment_key" ON "enrolment_milestone_notifications" ("enrolmentId", "milestoneKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enrolment_milestone_notifications_organisationId" ON "enrolment_milestone_notifications" ("organisationId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY enrolment_milestone_notifications_select ON enrolment_milestone_notifications
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY enrolment_milestone_notifications_insert ON enrolment_milestone_notifications
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY enrolment_milestone_notifications_update ON enrolment_milestone_notifications
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE "enrolment_milestone_notifications" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_milestone_notifications" FORCE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN IF NOT EXISTS "milestonesObservedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN IF EXISTS "milestonesObservedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_milestone_notifications" NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS enrolment_milestone_notifications_update ON enrolment_milestone_notifications`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS enrolment_milestone_notifications_insert ON enrolment_milestone_notifications`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS enrolment_milestone_notifications_select ON enrolment_milestone_notifications`,
    );
    await queryRunner.query(`DROP TABLE "enrolment_milestone_notifications"`);
    await queryRunner.query(
      `DROP TYPE "enrolment_milestone_notification_outcome"`,
    );
  }
}
