import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateEpaPackJobsTable1781100000007 implements MigrationInterface {
  name = 'CreateEpaPackJobsTable1781100000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "epa_pack_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "status" "evidence_pack_job_status" NOT NULL DEFAULT 'queued',
        "outputKey" character varying(1024),
        "errorMessage" text,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "manifest" jsonb,
        CONSTRAINT "PK_epa_pack_jobs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "epa_pack_jobs" ADD CONSTRAINT "FK_epa_pack_jobs_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "epa_pack_jobs" ADD CONSTRAINT "FK_epa_pack_jobs_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "epa_pack_jobs" ADD CONSTRAINT "FK_epa_pack_jobs_requestedByUserId" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_epa_pack_jobs_org_enrolment_created" ON "epa_pack_jobs" ("organisationId", "enrolmentId", "createdAt")`,
    );

    await ensureRlsHelperFunctions(queryRunner);
    await queryRunner.query(`
CREATE POLICY epa_pack_jobs_select ON epa_pack_jobs
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY epa_pack_jobs_insert ON epa_pack_jobs
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY epa_pack_jobs_update ON epa_pack_jobs
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY epa_pack_jobs_delete ON epa_pack_jobs
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE epa_pack_jobs ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE epa_pack_jobs FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE epa_pack_jobs NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE epa_pack_jobs DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS epa_pack_jobs_delete ON epa_pack_jobs`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS epa_pack_jobs_update ON epa_pack_jobs`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS epa_pack_jobs_insert ON epa_pack_jobs`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS epa_pack_jobs_select ON epa_pack_jobs`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_epa_pack_jobs_org_enrolment_created"`,
    );
    await queryRunner.query(`DROP TABLE "epa_pack_jobs"`);
  }
}
