import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLevyTransferPdfTemplate1780500000004 implements MigrationInterface {
  name = 'AddLevyTransferPdfTemplate1780500000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'levy_transfer_agreement'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop individual enum values without recreating the type.
  }
}
