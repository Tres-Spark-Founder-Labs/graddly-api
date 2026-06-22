import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class AddAutomationChaseTables1781100000013 implements MigrationInterface {
  name = 'AddAutomationChaseTables1781100000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "review_reminder_kind" ADD VALUE IF NOT EXISTS '48h'`,
    );

    await queryRunner.query(
      `CREATE TYPE "commitment_chase_kind" AS ENUM ('7d')`,
    );

    await queryRunner.query(
      `CREATE TABLE "commitment_chase_dispatches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "signatureId" uuid NOT NULL,
        "chaseKind" "commitment_chase_kind" NOT NULL,
        "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_commitment_chase_dispatches" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "commitment_chase_dispatches" ADD CONSTRAINT "FK_commitment_chase_dispatches_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commitment_chase_dispatches" ADD CONSTRAINT "FK_commitment_chase_dispatches_signatureId" FOREIGN KEY ("signatureId") REFERENCES "commitment_signatures"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_commitment_chase_dispatches_signature_kind" ON "commitment_chase_dispatches" ("signatureId", "chaseKind") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY commitment_chase_dispatches_select ON commitment_chase_dispatches
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY commitment_chase_dispatches_insert ON commitment_chase_dispatches
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY commitment_chase_dispatches_update ON commitment_chase_dispatches
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(
      `ALTER TABLE "commitment_chase_dispatches" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_chase_dispatches_update ON commitment_chase_dispatches`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_chase_dispatches_insert ON commitment_chase_dispatches`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_chase_dispatches_select ON commitment_chase_dispatches`,
    );
    await queryRunner.query(`DROP TABLE "commitment_chase_dispatches"`);
    await queryRunner.query(`DROP TYPE "commitment_chase_kind"`);
  }
}
