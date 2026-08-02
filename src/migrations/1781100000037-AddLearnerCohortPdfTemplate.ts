import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.2.1 AC5 — "table is exportable as CSV and PDF". The CSV half already
 * existed; this adds the enum value the PDF job rows need.
 *
 * `ADD VALUE IF NOT EXISTS` because Postgres cannot drop an enum value, so
 * the `down` is deliberately a no-op rather than a lie.
 */
export class AddLearnerCohortPdfTemplate1781100000037 implements MigrationInterface {
  name = 'AddLearnerCohortPdfTemplate1781100000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'learner_cohort'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums. Removing it would mean recreating
    // the type and rewriting every dependent column, which is not worth doing
    // to undo an additive change.
  }
}
