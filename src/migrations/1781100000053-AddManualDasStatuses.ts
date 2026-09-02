import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `manual` to the two DAS status enums.
 *
 * Both are temporary mode flags for deployments running without ESFA
 * credentials, where an administrator types figures in through `/das/manual/*`
 * instead of the platform syncing them. See `DasManualClient`.
 *
 * ── WHY THE VALUE HAS TO EXIST AT ALL ───────────────────────────────────────
 *
 * The sync-status card reads one field, `lastSyncStatus`. Without a distinct
 * value, a manually-entered balance has to be stored as `success` — and the
 * card then reports "Synced" over a figure nobody synced. Adding the value is
 * what lets the card stay honest without changing what it reads.
 *
 * ── ADD VALUE OUTSIDE A TRANSACTION ─────────────────────────────────────────
 *
 * `ALTER TYPE ... ADD VALUE` cannot run in the same transaction that then uses
 * the new value. PostgreSQL 12+ permits the statement inside a transaction,
 * but TypeORM wraps migrations in one, so `IF NOT EXISTS` is used to make the
 * statement safe to re-run rather than relying on transactional rollback.
 *
 * ── NO `down` FOR THE ENUM VALUES ───────────────────────────────────────────
 *
 * PostgreSQL cannot remove a value from an enum type. Reversing this properly
 * means recreating both types and rewriting every dependent column, which is a
 * heavier and riskier operation than the one being undone. `down` therefore
 * re-points any rows still carrying `manual` to a value that predates this
 * migration, which is the part that actually matters for a rollback, and says
 * plainly that the type keeps the value.
 */
export class AddManualDasStatuses1781100000053 implements MigrationInterface {
  name = 'AddManualDasStatuses1781100000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "das_sync_status" ADD VALUE IF NOT EXISTS 'manual'`,
    );
    await queryRunner.query(
      `ALTER TYPE "das_donor_link_status" ADD VALUE IF NOT EXISTS 'manual'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * `idle` is the honest landing place for a levy balance whose provenance
     * we can no longer express: it means "never synced", which is true of a
     * manually-entered figure. `error` is the equivalent for a donor link —
     * it was never a live connection.
     */
    await queryRunner.query(
      `UPDATE "das_levy_balances" SET "lastSyncStatus" = 'idle' WHERE "lastSyncStatus" = 'manual'`,
    );
    await queryRunner.query(
      `UPDATE "das_donor_links" SET "status" = 'error' WHERE "status" = 'manual'`,
    );

    // The enum types keep the value. PostgreSQL offers no DROP VALUE, and
    // recreating both types to remove an unused label would be a larger
    // operation than the one being reversed.
  }
}
