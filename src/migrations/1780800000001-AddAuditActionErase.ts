import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditActionErase1780800000001 implements MigrationInterface {
  name = 'AddAuditActionErase1780800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'erase'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values safely.
  }
}
