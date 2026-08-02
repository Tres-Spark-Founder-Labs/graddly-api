import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.1.3 — Self-Assessment Report drafts.
 *
 * Two columns carry the weight of this feature, and they exist because AC4
 * asks for a *historical record*:
 *
 * - `sections` is what the provider writes. Generation seeds each section's
 *   narrative from live data; the provider then edits it, because a SAR is a
 *   judgement and the platform can only supply the evidence for one.
 * - `metrics` is what the numbers were. Once a SAR is locked it must never
 *   move again, and every input — EIF scores, QIP progress, outcomes, review
 *   compliance, withdrawals — is a live figure that changes daily. Storing
 *   the computed snapshot is the only way "the SAR for 2025-26" still means
 *   in three years what it meant on the day it was locked. Recomputing on
 *   read would quietly rewrite history.
 *
 * The unique index is per organisation per academic year. A provider has one
 * self-assessment for a year, not a pile of drafts — and without the
 * constraint, "lock the SAR for 2025-26" has no single referent.
 */
export class AddSarReports1781100000036 implements MigrationInterface {
  name = 'AddSarReports1781100000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "sar_report_status" AS ENUM ('draft', 'locked')`,
    );

    await queryRunner.query(
      `CREATE TABLE "sar_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "academicYear" character varying(9) NOT NULL,
        "status" "sar_report_status" NOT NULL DEFAULT 'draft',
        "sections" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "generatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "generatedByUserId" uuid,
        "lockedAt" TIMESTAMP WITH TIME ZONE,
        "lockedByUserId" uuid,
        CONSTRAINT "PK_sar_reports" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "sar_reports" ADD CONSTRAINT "FK_sar_reports_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    /**
     * SET NULL rather than CASCADE: a locked SAR is a historical record, and
     * deleting the staff member who locked it must not delete the record of
     * the year. The name is denormalised into `metrics` at lock time for the
     * same reason.
     */
    await queryRunner.query(
      `ALTER TABLE "sar_reports" ADD CONSTRAINT "FK_sar_reports_generatedByUserId" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sar_reports" ADD CONSTRAINT "FK_sar_reports_lockedByUserId" FOREIGN KEY ("lockedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sar_reports_org_year" ON "sar_reports" ("organisationId", "academicYear") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sar_reports_org_year" ON "sar_reports" ("organisationId", "academicYear")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY sar_reports_select ON sar_reports
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY sar_reports_insert ON sar_reports
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY sar_reports_update ON sar_reports
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY sar_reports_delete ON sar_reports
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE sar_reports ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`ALTER TABLE sar_reports FORCE ROW LEVEL SECURITY`);

    /**
     * AC4 in the database, not only in the service.
     *
     * "Locked" is the whole value of this feature: it is what makes a SAR a
     * record rather than a document. A service-layer check is one forgotten
     * `save()` away from being bypassed — and this table is written by a
     * generate path, an edit path and a lock path, so there are three ways to
     * forget. The trigger allows exactly two transitions on a locked row:
     * nothing at all, and a soft delete.
     */
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION sar_reports_locked_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'locked' AND OLD."isDeleted" = false THEN
    IF NEW."isDeleted" = true THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sar_reports row % is locked and cannot be modified', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`);

    await queryRunner.query(`
CREATE TRIGGER trg_sar_reports_locked_is_immutable
BEFORE UPDATE ON sar_reports
FOR EACH ROW EXECUTE FUNCTION sar_reports_locked_is_immutable()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_sar_reports_locked_is_immutable ON sar_reports`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS sar_reports_locked_is_immutable()`,
    );
    await queryRunner.query(
      `ALTER TABLE sar_reports NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE sar_reports DISABLE ROW LEVEL SECURITY`,
    );
    for (const action of ['delete', 'update', 'insert', 'select']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS sar_reports_${action} ON sar_reports`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."IDX_sar_reports_org_year"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_sar_reports_org_year"`);
    await queryRunner.query(`DROP TABLE "sar_reports"`);
    await queryRunner.query(`DROP TYPE "sar_report_status"`);
  }
}
