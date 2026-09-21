import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.4.3 AC4 (web push in MVP) and F3.1.4 AC4 (the seven-day OTJ inactivity
 * alert). Three things.
 *
 * ── push_subscriptions ──────────────────────────────────────────────────────
 *
 * One row per browser a user opted in on: the endpoint and the two keys the
 * Push API hands back. Per user, so every policy is `"userId" =
 * app_current_user()` with the bootstrap arm — the same shape as
 * notification_preferences, and for the same reason: a subscription is the
 * person's, and the send path reads it for a recipient who is not the actor.
 * The endpoint is unique among live rows: a browser re-subscribing after its
 * old endpoint died gets a fresh row, and the dead one is soft-deleted when
 * the push service answers 404 or 410.
 *
 * ── notification_channel gains 'push' ───────────────────────────────────────
 *
 * So the per-type preferences (1781100000057) cover push as they cover email:
 * a stored (push, type) row can switch a type's push off. `ADD VALUE` cannot be
 * undone in Postgres short of rebuilding the type, so `down` leaves it.
 *
 * ── enrolments.otjInactivityAlertedAt ───────────────────────────────────────
 *
 * When the inactivity alert last went to this enrolment's apprentice. The
 * sweep runs daily and F3.1.4 AC6 wants the alert weekly, so this is what
 * makes it one per apprentice per week rather than one per run — the same
 * device `otjPaceAlertedAt` (1781000000006) uses for the pace alert.
 */
export class WebPushAndOtjInactivity1781100000058 implements MigrationInterface {
  name = 'WebPushAndOtjInactivity1781100000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE "push_subscriptions" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "isDeleted" boolean NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP,
  "userId" uuid NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "userAgent" character varying(512),
  CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"),
  CONSTRAINT "FK_push_subscriptions_userId" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_push_subscriptions_endpoint_active" ON "push_subscriptions" ("endpoint") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_subscriptions_user_active" ON "push_subscriptions" ("userId") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY push_subscriptions_select ON push_subscriptions
  FOR SELECT
  USING (app_rls_bootstrap() OR "userId" = app_current_user())`);
    await queryRunner.query(`
CREATE POLICY push_subscriptions_insert ON push_subscriptions
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "userId" = app_current_user())`);
    await queryRunner.query(`
CREATE POLICY push_subscriptions_update ON push_subscriptions
  FOR UPDATE
  USING (app_rls_bootstrap() OR "userId" = app_current_user())
  WITH CHECK (app_rls_bootstrap() OR "userId" = app_current_user())`);
    await queryRunner.query(`
CREATE POLICY push_subscriptions_delete ON push_subscriptions
  FOR DELETE
  USING (app_rls_bootstrap() OR "userId" = app_current_user())`);
    await queryRunner.query(
      `ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'push'`,
    );

    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "otjInactivityAlertedAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "otjInactivityAlertedAt"`,
    );
    // 'push' stays on notification_channel: Postgres cannot drop an enum value.
    await queryRunner.query(
      `ALTER TABLE push_subscriptions NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY`,
    );
    for (const action of ['delete', 'update', 'insert', 'select']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS push_subscriptions_${action} ON push_subscriptions`,
      );
    }
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
