import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `review_reminder_dispatches` joins row-level security.
 *
 * It was the one table in the scheduled-job set with RLS off and no policies
 * (found by the job probe, 23 September). The reminder sweep's "already
 * sent?" guard therefore worked only because the table was unprotected: the
 * row it reads and writes carried no organisation at all.
 *
 * ── THE ORDER HERE IS THE WHOLE POINT ───────────────────────────────────────
 *
 * 1. Add `organisationId`, nullable, and backfill it from each row's review.
 * 2. Refuse to go further if any row is still null. A policy keyed on a null
 *    column matches nothing: the guard would read nothing, and every learner
 *    with a scheduled review would get a duplicate reminder on the next run.
 *    Failing the migration is the safe outcome — the table stays as it was.
 * 3. Only then: NOT NULL, the foreign key, the index, and the policies.
 *
 * The policies are the shape its neighbours use
 * (`commitment_chase_dispatches`, `levy_expiry_alert_dispatches`): bootstrap
 * or the current organisation, for select, insert and update. No delete
 * policy, because nothing deletes a dispatch row — the sweep's guard depends
 * on it staying. FORCE is set, as on `reviews`, `notifications` and
 * `levy_expiry_alert_dispatches`.
 */
export class ReviewReminderDispatchesTenancy1781100000062 implements MigrationInterface {
  name = 'ReviewReminderDispatchesTenancy1781100000062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" ADD COLUMN IF NOT EXISTS "organisationId" uuid`,
    );

    // The review is the row's only tenant anchor, and it is NOT NULL.
    await queryRunner.query(
      `UPDATE "review_reminder_dispatches" d
          SET "organisationId" = r."organisationId"
         FROM "reviews" r
        WHERE r.id = d."reviewId" AND d."organisationId" IS NULL`,
    );

    const orphans: unknown = await queryRunner.query(
      `SELECT count(*) AS count FROM "review_reminder_dispatches" WHERE "organisationId" IS NULL`,
    );
    const firstRow = Array.isArray(orphans)
      ? (orphans[0] as { count?: string } | undefined)
      : undefined;
    const remaining = Number(firstRow?.count ?? 0);
    if (remaining > 0) {
      throw new Error(
        `review_reminder_dispatches: ${remaining} row(s) could not be attributed to an organisation. ` +
          'Refusing to add the policy: it would match nothing for those rows and the ' +
          'already-sent guard would stop guarding. Resolve the rows, then re-run.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" ALTER COLUMN "organisationId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" ADD CONSTRAINT "FK_review_reminder_dispatches_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_review_reminder_dispatches_organisationId" ON "review_reminder_dispatches" ("organisationId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY review_reminder_dispatches_select ON review_reminder_dispatches
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY review_reminder_dispatches_insert ON review_reminder_dispatches
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY review_reminder_dispatches_update ON review_reminder_dispatches
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS review_reminder_dispatches_update ON review_reminder_dispatches`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS review_reminder_dispatches_insert ON review_reminder_dispatches`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS review_reminder_dispatches_select ON review_reminder_dispatches`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_review_reminder_dispatches_organisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" DROP CONSTRAINT IF EXISTS "FK_review_reminder_dispatches_organisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_reminder_dispatches" DROP COLUMN IF EXISTS "organisationId"`,
    );
  }
}
