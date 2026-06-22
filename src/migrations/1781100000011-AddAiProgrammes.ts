import { MigrationInterface, QueryRunner } from 'typeorm';

import { AI_PROGRAMME_CATALOGUE_SEED } from '../ai-programmes/ai-programmes.constants.js';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class AddAiProgrammes1781100000011 implements MigrationInterface {
  name = 'AddAiProgrammes1781100000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "programme_delivery_type" AS ENUM ('employer_led', 'flowportal_ai')`,
    );
    await queryRunner.query(
      `ALTER TABLE "programmes" ADD "deliveryType" "programme_delivery_type" NOT NULL DEFAULT 'employer_led'`,
    );

    await queryRunner.query(
      `CREATE TYPE "ai_programme_module_progress_status" AS ENUM ('not_started', 'in_progress', 'completed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "ai_programme_modules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "programmeId" uuid NOT NULL,
        "slug" character varying(64) NOT NULL,
        "title" character varying(255) NOT NULL,
        "sortOrder" integer NOT NULL,
        "description" text,
        CONSTRAINT "PK_ai_programme_modules" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_modules" ADD CONSTRAINT "FK_ai_programme_modules_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_modules" ADD CONSTRAINT "FK_ai_programme_modules_programmeId" FOREIGN KEY ("programmeId") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ai_programme_modules_programme_slug" ON "ai_programme_modules" ("programmeId", "slug") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "ai_programme_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "moduleSlug" character varying(64) NOT NULL,
        "status" "ai_programme_module_progress_status" NOT NULL DEFAULT 'not_started',
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "metadata" jsonb,
        CONSTRAINT "PK_ai_programme_progress" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_progress" ADD CONSTRAINT "FK_ai_programme_progress_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_progress" ADD CONSTRAINT "FK_ai_programme_progress_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ai_programme_progress_enrolment_module" ON "ai_programme_progress" ("enrolmentId", "moduleSlug") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "ai_programme_completions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "completedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "summary" jsonb,
        CONSTRAINT "PK_ai_programme_completions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_completions" ADD CONSTRAINT "FK_ai_programme_completions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_programme_completions" ADD CONSTRAINT "FK_ai_programme_completions_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ai_programme_completions_enrolment" ON "ai_programme_completions" ("enrolmentId") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'ai_programme_modules',
      'ai_programme_progress',
      'ai_programme_completions',
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

    await this.seedCatalogue(queryRunner);
  }

  private async seedCatalogue(queryRunner: QueryRunner): Promise<void> {
    const seed = AI_PROGRAMME_CATALOGUE_SEED;
    const orgId = seed.providerOrgId;
    const slug = seed.providerSlug.replace(/'/g, "''");

    await queryRunner.query(
      `INSERT INTO organisations (id, name, slug, "portalType")
       VALUES ('${orgId}', 'FlowPortal AI Provider', '${slug}', 'provider')
       ON CONFLICT (slug) DO NOTHING`,
    );

    for (const programme of seed.programmes) {
      const description = (programme.description ?? '').replace(/'/g, "''");
      await queryRunner.query(
        `INSERT INTO programmes (id, "organisationId", code, title, description, status, "deliveryType")
         VALUES ('${programme.id}', '${orgId}', '${programme.code}', '${programme.title}', '${description}', 'active', 'flowportal_ai')
         ON CONFLICT DO NOTHING`,
      );

      await queryRunner.query(
        `INSERT INTO standards (id, "organisationId", "programmeId", code, title, status)
         VALUES ('${programme.standardId}', '${orgId}', '${programme.id}', '${programme.standardCode}', '${programme.title} Standard', 'active')
         ON CONFLICT DO NOTHING`,
      );

      for (const mod of programme.modules) {
        const modDescription = (mod.description ?? '').replace(/'/g, "''");
        await queryRunner.query(
          `INSERT INTO ai_programme_modules ("organisationId", "programmeId", slug, title, "sortOrder", description)
           VALUES ('${orgId}', '${programme.id}', '${mod.slug}', '${mod.title}', ${mod.sortOrder}, '${modDescription}')`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'ai_programme_completions',
      'ai_programme_progress',
      'ai_programme_modules',
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
      `DROP INDEX "public"."UQ_ai_programme_completions_enrolment"`,
    );
    await queryRunner.query(`DROP TABLE "ai_programme_completions"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_ai_programme_progress_enrolment_module"`,
    );
    await queryRunner.query(`DROP TABLE "ai_programme_progress"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_ai_programme_modules_programme_slug"`,
    );
    await queryRunner.query(`DROP TABLE "ai_programme_modules"`);

    await queryRunner.query(
      `ALTER TABLE "programmes" DROP COLUMN "deliveryType"`,
    );
    await queryRunner.query(`DROP TYPE "ai_programme_module_progress_status"`);
    await queryRunner.query(`DROP TYPE "programme_delivery_type"`);
  }
}
