import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateInterventionActions1781100000009 implements MigrationInterface {
  name = 'CreateInterventionActions1781100000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "intervention_action_type" AS ENUM ('contact_made', 'review_scheduled', 'employer_notified', 'escalated')`,
    );
    await queryRunner.query(
      `CREATE TABLE "intervention_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "actionType" "intervention_action_type" NOT NULL,
        "notes" text,
        "createdByUserId" uuid NOT NULL,
        CONSTRAINT "PK_intervention_actions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "intervention_actions" ADD CONSTRAINT "FK_intervention_actions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "intervention_actions" ADD CONSTRAINT "FK_intervention_actions_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "intervention_actions" ADD CONSTRAINT "FK_intervention_actions_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_intervention_actions_org_enrolment" ON "intervention_actions" ("organisationId", "enrolmentId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);
    await queryRunner.query(`
CREATE POLICY intervention_actions_select ON intervention_actions
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY intervention_actions_insert ON intervention_actions
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY intervention_actions_update ON intervention_actions
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY intervention_actions_delete ON intervention_actions
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE intervention_actions ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE intervention_actions FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE intervention_actions NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE intervention_actions DISABLE ROW LEVEL SECURITY`,
    );
    for (const op of ['delete', 'update', 'insert', 'select']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS intervention_actions_${op} ON intervention_actions`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_intervention_actions_org_enrolment"`,
    );
    await queryRunner.query(`DROP TABLE "intervention_actions"`);
    await queryRunner.query(`DROP TYPE "intervention_action_type"`);
  }
}
