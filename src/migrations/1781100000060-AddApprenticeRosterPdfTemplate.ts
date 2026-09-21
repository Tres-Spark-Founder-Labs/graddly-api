import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.1 AC6 — "Table is exportable as CSV and PDF". The CSV half is built in
 * the employer portal; this adds the enum value the PDF job rows need for the
 * apprentice roster, on the same pipeline as the provider's learner cohort
 * (1781100000037).
 *
 * `ADD VALUE IF NOT EXISTS` because Postgres cannot drop an enum value, so
 * the `down` is deliberately a no-op rather than a lie.
 */
export class AddApprenticeRosterPdfTemplate1781100000060 implements MigrationInterface {
  name = 'AddApprenticeRosterPdfTemplate1781100000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'apprentice_roster'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums; see 1781100000037.
  }
}
