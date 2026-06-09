import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogEntriesUpdatePolicy1780800000002 implements MigrationInterface {
  name = 'AddAuditLogEntriesUpdatePolicy1780800000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE POLICY audit_log_entries_update ON audit_log_entries
  FOR UPDATE
  USING (
    app_rls_bootstrap()
    OR "organisationId" = app_current_org()
  )
  WITH CHECK (
    app_rls_bootstrap()
    OR "organisationId" = app_current_org()
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS audit_log_entries_update ON audit_log_entries`,
    );
  }
}
