import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.3 AC1 — the audit trail must record views, signature actions and
 * version changes, none of which the `audit_action` enum could express.
 *
 * It held `insert`, `update`, `delete` and `erase`: the four things a TypeORM
 * entity subscriber can observe. That is a record of row changes, not of what
 * people did. Signing a commitment statement appeared as an `update` to a
 * signature row — accurate, and useless to an inspector asking who signed
 * what and when. Viewing a statement appeared as nothing at all, because
 * reads do not write.
 *
 * Adding values to an enum in Postgres is not transactional before 12 and
 * cannot be reversed, hence the guarded `ADD VALUE IF NOT EXISTS` and the
 * deliberately empty `down`.
 */
export class AuditActionsForCommitments1781100000028 implements MigrationInterface {
  name = 'AuditActionsForCommitments1781100000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'view'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'sign'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'version_change'`,
    );
  }

  /**
   * Intentionally a no-op.
   *
   * Postgres cannot drop a value from an enum. Removing one means recreating
   * the type and rewriting every column that uses it, which on an append-only
   * audit table would mean rewriting rows this platform has just gone to some
   * trouble to make unrewritable. Rolling this back would therefore either
   * fail against the immutability trigger or destroy evidence; leaving three
   * unused enum values behind costs nothing.
   */
  public async down(): Promise<void> {
    // See the note above: enum values cannot be removed safely here.
  }
}
