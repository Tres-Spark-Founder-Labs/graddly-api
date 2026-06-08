import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/* eslint-disable @typescript-eslint/naming-convention -- ILR ESFA field and entity names */
const SEED_MAPPING_CONFIG = {
  _comment:
    'Minimal apprenticeship ILR field subset for 2025-26 v1 — not the full ESFA specification. Expand annually via new published mapping config versions.',
  academicYear: '2025-26',
  entities: {
    Learner: {
      LearnRefNumber: {
        source: 'enrolment.id',
        transform: 'ilrRef',
        required: true,
      },
      FamilyName: { source: 'apprentice.lastName', required: true },
      GivenNames: { source: 'apprentice.firstName', required: true },
      ULN: { source: 'manual', required: false },
    },
    LearningDelivery: {
      LearnAimRef: { source: 'standard.code', required: true },
      LearnStartDate: {
        source: 'enrolment.plannedStartDate',
        transform: 'ilrDate',
        required: true,
      },
      LearnPlanEndDate: {
        source: 'enrolment.plannedEndDate',
        transform: 'ilrDate',
        required: false,
      },
      ProgType: { source: 'constant', value: '25', required: true },
    },
    Provider: {
      UKPRN: { source: 'organisation.ukprn', required: true },
    },
  },
  rules: [
    {
      code: 'ILR001',
      severity: 'error',
      field: 'Provider.UKPRN',
      type: 'required',
      message: 'Provider UKPRN is required for ILR submission.',
    },
    {
      code: 'ILR002',
      severity: 'error',
      field: 'LearningDelivery.LearnStartDate',
      type: 'dateNotAfter',
      otherField: 'LearningDelivery.LearnPlanEndDate',
      message: 'Start date must be on or before planned end date.',
    },
  ],
};
/* eslint-enable @typescript-eslint/naming-convention */

export class CreateIlrTables1780200000000 implements MigrationInterface {
  name = 'CreateIlrTables1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "ilr_mapping_config_status" AS ENUM ('draft', 'published', 'superseded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "ilr_learner_record_status" AS ENUM ('draft', 'validated', 'validation_failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "ilr_submission_status" AS ENUM ('queued', 'processing', 'submitted', 'failed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "ilr_mapping_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "academicYear" character varying(9) NOT NULL,
        "version" integer NOT NULL,
        "status" "ilr_mapping_config_status" NOT NULL DEFAULT 'draft',
        "config" jsonb NOT NULL,
        "publishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_ilr_mapping_configs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ilr_mapping_configs_year_version" ON "ilr_mapping_configs" ("academicYear", "version")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ilr_mapping_configs_published_year" ON "ilr_mapping_configs" ("academicYear") WHERE "status" = 'published' AND "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "ilr_learner_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "apprenticeId" uuid NOT NULL,
        "collectionPeriod" character varying(7) NOT NULL,
        "academicYear" character varying(9) NOT NULL,
        "mappingConfigId" uuid NOT NULL,
        "mappingConfigVersion" integer NOT NULL,
        "fields" jsonb NOT NULL,
        "manualOverrides" jsonb NOT NULL DEFAULT '{}',
        "status" "ilr_learner_record_status" NOT NULL DEFAULT 'draft',
        "lastValidatedAt" TIMESTAMP WITH TIME ZONE,
        "validationSummary" jsonb,
        CONSTRAINT "PK_ilr_learner_records" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_learner_records" ADD CONSTRAINT "FK_ilr_learner_records_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_learner_records" ADD CONSTRAINT "FK_ilr_learner_records_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_learner_records" ADD CONSTRAINT "FK_ilr_learner_records_apprenticeId" FOREIGN KEY ("apprenticeId") REFERENCES "apprentices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_learner_records" ADD CONSTRAINT "FK_ilr_learner_records_mappingConfigId" FOREIGN KEY ("mappingConfigId") REFERENCES "ilr_mapping_configs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ilr_learner_records_active_org_enrolment_period" ON "ilr_learner_records" ("organisationId", "enrolmentId", "collectionPeriod") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "ilr_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "ilrLearnerRecordId" uuid NOT NULL,
        "attempt" integer NOT NULL,
        "isAmendment" boolean NOT NULL DEFAULT false,
        "amendsSubmissionId" uuid,
        "status" "ilr_submission_status" NOT NULL DEFAULT 'queued',
        "esfaReference" character varying(100),
        "receipt" jsonb,
        "submittedAt" TIMESTAMP WITH TIME ZONE,
        "failedAt" TIMESTAMP WITH TIME ZONE,
        "lastError" text,
        "requestPayload" jsonb,
        CONSTRAINT "PK_ilr_submissions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_submissions" ADD CONSTRAINT "FK_ilr_submissions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_submissions" ADD CONSTRAINT "FK_ilr_submissions_ilrLearnerRecordId" FOREIGN KEY ("ilrLearnerRecordId") REFERENCES "ilr_learner_records"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ilr_submissions" ADD CONSTRAINT "FK_ilr_submissions_amendsSubmissionId" FOREIGN KEY ("amendsSubmissionId") REFERENCES "ilr_submissions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ilr_submissions_org_record_created" ON "ilr_submissions" ("organisationId", "ilrLearnerRecordId", "createdAt")`,
    );

    const seedJson = JSON.stringify(SEED_MAPPING_CONFIG).replace(/'/g, "''");
    await queryRunner.query(
      `INSERT INTO "ilr_mapping_configs" ("academicYear", "version", "status", "config", "publishedAt")
       VALUES ('2025-26', 1, 'published', '${seedJson}'::jsonb, now())`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of ['ilr_learner_records', 'ilr_submissions'] as const) {
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
    for (const table of ['ilr_submissions', 'ilr_learner_records'] as const) {
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_delete ON ${table}`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_update ON ${table}`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_insert ON ${table}`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_select ON ${table}`,
      );
    }

    await queryRunner.query(`DROP TABLE "ilr_submissions"`);
    await queryRunner.query(`DROP TABLE "ilr_learner_records"`);
    await queryRunner.query(`DROP TABLE "ilr_mapping_configs"`);
    await queryRunner.query(`DROP TYPE "ilr_submission_status"`);
    await queryRunner.query(`DROP TYPE "ilr_learner_record_status"`);
    await queryRunner.query(`DROP TYPE "ilr_mapping_config_status"`);
  }
}
