import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employers and linked providers read enrolments via organisation link columns,
 * not only the owning organisationId (typically the provider).
 */
export class EnrolmentsRlsLinkedOrganisations1781100000015 implements MigrationInterface {
  name = 'EnrolmentsRlsLinkedOrganisations1781100000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS enrolments_select ON enrolments`,
    );
    await queryRunner.query(`
CREATE POLICY enrolments_select ON enrolments
  FOR SELECT
  USING (
    app_rls_bootstrap()
    OR "organisationId" = app_current_org()
    OR "employerOrganisationId" = app_current_org()
    OR "providerOrganisationId" = app_current_org()
    OR "apprenticeUserId" = app_current_user()
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS enrolments_select ON enrolments`,
    );
    await queryRunner.query(`
CREATE POLICY enrolments_select ON enrolments
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
  }
}
