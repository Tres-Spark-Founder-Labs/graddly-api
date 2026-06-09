import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateQipActionsTable1780300000000 implements MigrationInterface {
  name = 'CreateQipActionsTable1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "qip_action_status" AS ENUM ('not_started', 'in_progress', 'completed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "qip_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "title" character varying(255) NOT NULL,
        "description" text,
        "assignedOwnerUserId" uuid NOT NULL,
        "targetCompletionDate" date NOT NULL,
        "eifCriterionSlug" character varying(64) NOT NULL,
        "evidenceNotes" text,
        "evidenceAttachmentKeys" jsonb,
        "status" "qip_action_status" NOT NULL DEFAULT 'not_started',
        CONSTRAINT "PK_qip_actions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "qip_actions" ADD CONSTRAINT "FK_qip_actions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "qip_actions" ADD CONSTRAINT "FK_qip_actions_assignedOwnerUserId" FOREIGN KEY ("assignedOwnerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_qip_actions_org_status_target" ON "qip_actions" ("organisationId", "status", "targetCompletionDate")`,
    );

    await ensureRlsHelperFunctions(queryRunner);
    await queryRunner.query(`
CREATE POLICY qip_actions_select ON qip_actions
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY qip_actions_insert ON qip_actions
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY qip_actions_update ON qip_actions
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY qip_actions_delete ON qip_actions
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE qip_actions ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`ALTER TABLE qip_actions FORCE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE qip_actions NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE qip_actions DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS qip_actions_delete ON qip_actions`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS qip_actions_update ON qip_actions`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS qip_actions_insert ON qip_actions`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS qip_actions_select ON qip_actions`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_qip_actions_org_status_target"`,
    );
    await queryRunner.query(`DROP TABLE "qip_actions"`);
    await queryRunner.query(`DROP TYPE "qip_action_status"`);
  }
}
