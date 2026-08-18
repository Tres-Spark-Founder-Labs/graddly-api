import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.4.3 — notifications could not be written to anybody but the acting user.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `notifications_insert` was:
 *
 *     WITH CHECK (app_rls_bootstrap() OR "userId" = app_current_user())
 *
 * A notification exists to tell *somebody else* something. `createForUser` is a
 * plain `repo.save` with no bootstrap, so the check failed at every call site
 * where the recipient was not the actor — which is nearly all of them.
 *
 * Measured, not inferred. Against the real `graddly_app` role (NOSUPERUSER
 * NOBYPASSRLS, RLS enabled *and* forced):
 *
 *   actor A -> notification for B, no bootstrap : 42501, policy violation
 *   actor A -> notification for A               : passes
 *   actor A -> notification for B, bootstrap on : passes
 *
 * The user-visible consequence was worse than a missing notification. An
 * employer approving an off-the-job log got HTTP 500 while the approval itself
 * committed: the failed INSERT aborted the transaction, a bare `catch {}`
 * swallowed the 42501, and the next query on the poisoned connection raised
 * 25P02. The apprentice was never told, and the employer saw an error for an
 * operation that had in fact succeeded.
 *
 * ── WHY ORGANISATION AND NOT BOOTSTRAP ──────────────────────────────────────
 *
 * The alternative was `setRlsBootstrap(true)` at each call site. Rejected:
 * bootstrap is a *full* RLS bypass, there are 18 call sites, and every future
 * one inherits the same trap. That would be 18 standing invitations to write
 * across a tenant boundary in order to fix a check that was simply keyed on the
 * wrong column.
 *
 * ── WHY THIS IS SAFE ────────────────────────────────────────────────────────
 *
 * Only `notifications_insert` changes. `notifications_select` stays keyed on
 * `"userId" = app_current_user()` and is therefore strictly tighter than the
 * new insert rule, so a same-organisation insert cannot become a read by the
 * wrong person. Measured with two real users in one organisation:
 *
 *   A reading a notification addressed to B : 0 rows
 *   B reading their own                     : 1 row
 *
 * That asymmetry is the entire safety argument. If `notifications_select` is
 * ever widened to be organisation-keyed, this insert policy becomes a
 * disclosure route and must be revisited in the same change.
 *
 * The residual risk is spoofing, not disclosure: a member could write a
 * notification into a colleague's tray. Every writer today is a server-side
 * service rather than user input, which makes that narrow — and it is a far
 * smaller exposure than 18 RLS bypasses.
 *
 * ── OUT OF SCOPE ────────────────────────────────────────────────────────────
 *
 * This fixes the request-scoped sites. `ReviewsReminderService` runs from cron
 * with no organisation either, so it is still broken after this migration. That
 * is a separate defect with a separate cause and is deliberately not addressed
 * here.
 */
export class NotificationsInsertKeyedOnOrganisation1781100000051 implements MigrationInterface {
  name = 'NotificationsInsertKeyedOnOrganisation1781100000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Refuse rather than guess.
     *
     * `organisationId` is nullable today. Any existing NULL row would be
     * unwritable *and* unreadable under an organisation-keyed rule, and there
     * is no correct value to invent for it — a notification's organisation is
     * not derivable from its recipient, who may belong to several.
     *
     * This check runs here rather than only in a developer's console because
     * the local table is empty and proves nothing about a deployed one.
     */
    const rows = (await queryRunner.query(
      `SELECT count(*)::text AS count FROM notifications WHERE "organisationId" IS NULL`,
    )) as { count: string }[];
    const count = rows[0]?.count ?? '0';

    if (Number(count) > 0) {
      throw new Error(
        `Refusing to migrate: ${count} notification row(s) have a NULL ` +
          `"organisationId". An organisation-keyed insert policy would make ` +
          `them unwritable, and there is no safe value to backfill — a ` +
          `notification's organisation cannot be derived from its recipient. ` +
          `Decide what those rows should be, then re-run.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "organisationId" SET NOT NULL`,
    );

    await queryRunner.query(
      `DROP POLICY IF EXISTS notifications_insert ON notifications`,
    );

    /**
     * `app_current_org()` alone is not enough: an empty GUC would make the
     * comparison NULL, and a NULL WITH CHECK fails closed — which is correct,
     * but silently. The bootstrap arm is retained so genuine system writes
     * (migrations, platform ops) still work.
     */
    await queryRunner.query(`
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR "organisationId" = app_current_org()
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS notifications_insert ON notifications`,
    );

    await queryRunner.query(`
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR "userId" = app_current_user()
  )`);

    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "organisationId" DROP NOT NULL`,
    );
  }
}
