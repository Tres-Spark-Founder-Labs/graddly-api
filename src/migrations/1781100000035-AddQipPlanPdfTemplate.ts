import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.1.2 AC5 — "QIP is exportable as PDF in Ofsted-standard format".
 *
 * The plan could be created, assigned and tracked, but never produced as a
 * document — so the one artefact an inspector actually asks for was the one
 * thing the feature could not make.
 */
export class AddQipPlanPdfTemplate1781100000035 implements MigrationInterface {
  name = 'AddQipPlanPdfTemplate1781100000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'qip_plan'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres enum values cannot be removed safely.
  }
}
