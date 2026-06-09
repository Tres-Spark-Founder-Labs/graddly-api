import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLevyRoiReportPdfTemplate1780700000001 implements MigrationInterface {
  name = 'AddLevyRoiReportPdfTemplate1780700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'levy_roi_report'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres enum values cannot be removed safely.
  }
}
