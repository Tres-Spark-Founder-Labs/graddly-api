import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganisationsSelectBootstrapPolicy1780500000006 implements MigrationInterface {
  name = 'AddOrganisationsSelectBootstrapPolicy1780500000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS organisations_select ON organisations`,
    );
    await queryRunner.query(`
CREATE POLICY organisations_select ON organisations
  FOR SELECT
  USING (
    app_rls_bootstrap()
    OR id = app_current_org()
    OR app_user_member_of_org(id)
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS organisations_select ON organisations`,
    );
    await queryRunner.query(`
CREATE POLICY organisations_select ON organisations
  FOR SELECT
  USING (
    id = app_current_org()
    OR app_user_member_of_org(id)
  )`);
  }
}
