import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.4.2 AC3 — "comparison is exportable as CSV and PDF".
 *
 * CSV is served synchronously from the breakdown endpoint; the PDF goes
 * through the shared job pipeline like every other document here, so the
 * template needs its enum value.
 */
export class AddProviderComparisonPdfTemplate1781100000033 implements MigrationInterface {
  name = 'AddProviderComparisonPdfTemplate1781100000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'provider_comparison'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres enum values cannot be removed safely.
  }
}
