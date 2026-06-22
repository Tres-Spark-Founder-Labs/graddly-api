import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateEifRealInputTables1781100000008 implements MigrationInterface {
  name = 'CreateEifRealInputTables1781100000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "programme_document_type" AS ENUM ('curriculum_map', 'assessment_strategy', 'industry_engagement')`,
    );

    await queryRunner.query(
      `CREATE TABLE "safeguarding_checklist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "slug" character varying(64) NOT NULL,
        "label" character varying(255) NOT NULL,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "evidenceStorageKey" character varying(512),
        CONSTRAINT "PK_safeguarding_checklist_items" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "safeguarding_checklist_items" ADD CONSTRAINT "FK_safeguarding_checklist_items_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_safeguarding_checklist_org_slug" ON "safeguarding_checklist_items" ("organisationId", "slug") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "programme_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "programmeId" uuid NOT NULL,
        "documentType" "programme_document_type" NOT NULL,
        "storageKey" character varying(512) NOT NULL,
        "uploadedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_programme_documents" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_documents" ADD CONSTRAINT "FK_programme_documents_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_documents" ADD CONSTRAINT "FK_programme_documents_programmeId" FOREIGN KEY ("programmeId") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_programme_documents_programme_type" ON "programme_documents" ("programmeId", "documentType") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'safeguarding_checklist_items',
      'programme_documents',
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
      'programme_documents',
      'safeguarding_checklist_items',
    ]) {
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      for (const op of ['delete', 'update', 'insert', 'select']) {
        await queryRunner.query(
          `DROP POLICY IF EXISTS ${table}_${op} ON ${table}`,
        );
      }
    }

    await queryRunner.query(
      `DROP INDEX "public"."UQ_programme_documents_programme_type"`,
    );
    await queryRunner.query(`DROP TABLE "programme_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_safeguarding_checklist_org_slug"`,
    );
    await queryRunner.query(`DROP TABLE "safeguarding_checklist_items"`);
    await queryRunner.query(`DROP TYPE "programme_document_type"`);
  }
}
