import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.2.5 AC3 — the notification type for a tutor over the at-risk caseload
 * threshold.
 *
 * `notification_type` is a Postgres enum, so adding a value to the TypeScript
 * enum alone is not enough: the insert fails at runtime with "invalid input
 * value for enum". That failure would land inside a cron sweep, where nobody
 * is watching — and the symptom of a broken alert is silence, which is
 * indistinguishable from "no tutor is over the threshold".
 *
 * `IF NOT EXISTS` because the value may already be present in an environment
 * migrated out of order.
 */
export class AddCaseloadAtRiskNotificationType1781100000045 implements MigrationInterface {
  name = 'AddCaseloadAtRiskNotificationType1781100000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'caseload_at_risk'`,
    );
  }

  public async down(): Promise<void> {
    /**
     * Postgres cannot drop a value from an enum. Reversing this would mean
     * recreating the type and rewriting every dependent column, which is a
     * far more dangerous operation than the one being undone — and it would
     * fail anyway against any row already using the value.
     *
     * Left as a no-op deliberately, matching how the other enum-extension
     * migrations in this project handle it.
     */
  }
}
