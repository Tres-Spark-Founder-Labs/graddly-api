import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class AddDasOutboundPushTables1780800000004 implements MigrationInterface {
  name = 'AddDasOutboundPushTables1780800000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "enrolment_push_status" AS ENUM ('queued', 'processing', 'delivered', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "enrolment_push_trigger" AS ENUM ('ilr_created', 'ilr_submitted')`,
    );
    await queryRunner.query(
      `CREATE TYPE "completion_push_status" AS ENUM ('queued', 'processing', 'delivered', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "completion_push_trigger" AS ENUM ('enrolment_completed', 'epa_outcome_recorded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "epa_outcome" AS ENUM ('pass', 'merit', 'distinction', 'fail')`,
    );

    await queryRunner.query(
      `CREATE TABLE "enrolment_submission_pushes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "apprenticeId" uuid NOT NULL,
        "ilrLearnerRecordId" uuid NOT NULL,
        "ilrSubmissionId" uuid,
        "trigger" "enrolment_push_trigger" NOT NULL,
        "status" "enrolment_push_status" NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text,
        "nextRetryAt" TIMESTAMP WITH TIME ZONE,
        "deliveredAt" TIMESTAMP WITH TIME ZONE,
        "dasReference" character varying(128),
        "manualRetryRequestedAt" TIMESTAMP WITH TIME ZONE,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_enrolment_submission_pushes" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "enrolment_completion_pushes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "apprenticeId" uuid NOT NULL,
        "epaOutcomeId" uuid,
        "trigger" "completion_push_trigger" NOT NULL,
        "status" "completion_push_status" NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text,
        "nextRetryAt" TIMESTAMP WITH TIME ZONE,
        "deliveredAt" TIMESTAMP WITH TIME ZONE,
        "dasReference" character varying(128),
        "manualRetryRequestedAt" TIMESTAMP WITH TIME ZONE,
        "payload" jsonb NOT NULL,
        CONSTRAINT "PK_enrolment_completion_pushes" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "epa_outcomes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "outcome" "epa_outcome" NOT NULL,
        "assessedOn" date NOT NULL,
        "recordedByUserId" uuid,
        CONSTRAINT "PK_epa_outcomes" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "enrolment_submission_pushes" ADD CONSTRAINT "FK_enrolment_submission_pushes_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_submission_pushes" ADD CONSTRAINT "FK_enrolment_submission_pushes_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_submission_pushes" ADD CONSTRAINT "FK_enrolment_submission_pushes_apprenticeId" FOREIGN KEY ("apprenticeId") REFERENCES "apprentices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_completion_pushes" ADD CONSTRAINT "FK_enrolment_completion_pushes_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_completion_pushes" ADD CONSTRAINT "FK_enrolment_completion_pushes_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolment_completion_pushes" ADD CONSTRAINT "FK_enrolment_completion_pushes_apprenticeId" FOREIGN KEY ("apprenticeId") REFERENCES "apprentices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "epa_outcomes" ADD CONSTRAINT "FK_epa_outcomes_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "epa_outcomes" ADD CONSTRAINT "FK_epa_outcomes_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_enrolment_push_org_status_created" ON "enrolment_submission_pushes" ("organisationId", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_enrolment_push_ilr_trigger" ON "enrolment_submission_pushes" ("ilrLearnerRecordId", "trigger") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_completion_push_org_status_created" ON "enrolment_completion_pushes" ("organisationId", "status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_completion_push_enrolment_trigger" ON "enrolment_completion_pushes" ("enrolmentId", "trigger") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_epa_outcomes_enrolment" ON "epa_outcomes" ("enrolmentId") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'enrolment_submission_pushes',
      'enrolment_completion_pushes',
      'epa_outcomes',
    ]) {
      await queryRunner.query(`
CREATE POLICY ${table}_select ON ${table}
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_insert ON ${table}
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_update ON ${table}
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_delete ON ${table}
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'epa_outcomes',
      'enrolment_completion_pushes',
      'enrolment_submission_pushes',
    ]) {
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      for (const action of ['delete', 'update', 'insert', 'select']) {
        await queryRunner.query(
          `DROP POLICY IF EXISTS ${table}_${action} ON ${table}`,
        );
      }
    }

    await queryRunner.query(`DROP INDEX "public"."UQ_epa_outcomes_enrolment"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_completion_push_enrolment_trigger"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_completion_push_org_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_enrolment_push_ilr_trigger"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_enrolment_push_org_status_created"`,
    );

    await queryRunner.query(`DROP TABLE "epa_outcomes"`);
    await queryRunner.query(`DROP TABLE "enrolment_completion_pushes"`);
    await queryRunner.query(`DROP TABLE "enrolment_submission_pushes"`);

    await queryRunner.query(`DROP TYPE "epa_outcome"`);
    await queryRunner.query(`DROP TYPE "completion_push_trigger"`);
    await queryRunner.query(`DROP TYPE "completion_push_status"`);
    await queryRunner.query(`DROP TYPE "enrolment_push_trigger"`);
    await queryRunner.query(`DROP TYPE "enrolment_push_status"`);
  }
}
