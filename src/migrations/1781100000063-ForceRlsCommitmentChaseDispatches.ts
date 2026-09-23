import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `commitment_chase_dispatches` gets FORCE ROW LEVEL SECURITY.
 *
 * It was the last of the five dispatch and notification tables without it:
 * `reviews`, `notifications`, `levy_expiry_alert_dispatches` and
 * `review_reminder_dispatches` (1781100000062) all have it.
 *
 * ── WHAT FORCE ADDS, AND WHAT IT DOES NOT ───────────────────────────────────
 *
 * ENABLE applies the policies to every role except the table's owner and a
 * superuser; FORCE removes the owner's exemption. The application connects as
 * `graddly_app`, which is neither, so its behaviour does not change — the
 * table is already policy-scoped for it, which is why the gap was invisible.
 *
 * What it changes is the day the owner is not a superuser: a migration role
 * with ownership but no BYPASSRLS, or an ops session connected as the owner,
 * is then subject to the same predicate as the app. That is what the other
 * four tables already assume, and this one did not.
 *
 * Proved both ways in a rolled-back transaction, with a temporary
 * non-superuser role holding ownership: with FORCE the owner's SELECT returns
 * only its own organisation's rows and an insert for another organisation is
 * refused; with NO FORCE the same role sees every row.
 *
 * ── SEQUENCE ────────────────────────────────────────────────────────────────
 *
 * The order 1781100000062 proved: confirm the column first, then the policy.
 * Here the column already exists and is `NOT NULL` (added with the table in
 * 1781100000013), so there is nothing to backfill — but the check is made
 * rather than assumed, because FORCE on a table whose organisation column
 * could be null would make the owner's reads match nothing.
 */
export class ForceRlsCommitmentChaseDispatches1781100000063 implements MigrationInterface {
  name = 'ForceRlsCommitmentChaseDispatches1781100000063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns: unknown = await queryRunner.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'commitment_chase_dispatches'
          AND column_name = 'organisationId'`,
    );
    const column = Array.isArray(columns)
      ? /* eslint-disable-next-line @typescript-eslint/naming-convention --
           information_schema column names are snake_case */
        (columns[0] as { is_nullable?: string } | undefined)
      : undefined;
    if (!column) {
      throw new Error(
        'commitment_chase_dispatches has no organisationId column: refusing to ' +
          'force row-level security on a table the policy cannot key on.',
      );
    }
    if (column.is_nullable !== 'NO') {
      throw new Error(
        'commitment_chase_dispatches."organisationId" is nullable: backfill and ' +
          'set NOT NULL before forcing row-level security, as 1781100000062 did.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "commitment_chase_dispatches" FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commitment_chase_dispatches" NO FORCE ROW LEVEL SECURITY`,
    );
  }
}
