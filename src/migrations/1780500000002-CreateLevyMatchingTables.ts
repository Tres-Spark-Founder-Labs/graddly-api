import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateLevyMatchingTables1780500000002 implements MigrationInterface {
  name = 'CreateLevyMatchingTables1780500000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "levy_match_application_status" AS ENUM ('pending', 'confirmed', 'rejected', 'withdrawn')`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_recipient_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "sector" character varying(100) NOT NULL,
        "region" character varying(100) NOT NULL,
        "employeeCountBand" character varying(50) NOT NULL,
        "programmeType" character varying(100) NOT NULL,
        "transferAmountRequired" numeric(14,2) NOT NULL,
        "hasDasAccount" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_levy_recipient_profiles" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_recipient_profiles" ADD CONSTRAINT "FK_levy_recipient_profiles_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_recipient_profiles_org" ON "levy_recipient_profiles" ("organisationId") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_transfer_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "sectors" jsonb NOT NULL DEFAULT '[]',
        "regions" jsonb NOT NULL DEFAULT '[]',
        "sizeBands" jsonb NOT NULL DEFAULT '[]',
        "programmeTypes" jsonb NOT NULL DEFAULT '[]',
        "maxPerRecipient" numeric(14,2),
        "openMatching" boolean NOT NULL DEFAULT false,
        "anonymousMatching" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_levy_transfer_preferences" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_preferences" ADD CONSTRAINT "FK_levy_transfer_preferences_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_transfer_preferences_org" ON "levy_transfer_preferences" ("organisationId") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_match_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "donorOrganisationId" uuid NOT NULL,
        "recipientOrganisationId" uuid NOT NULL,
        "requestedAmount" numeric(14,2) NOT NULL,
        "status" "levy_match_application_status" NOT NULL DEFAULT 'pending',
        "matchScore" numeric(5,2),
        "scoreBreakdown" jsonb,
        CONSTRAINT "PK_levy_match_applications" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_match_applications" ADD CONSTRAINT "FK_levy_match_applications_donorOrganisationId" FOREIGN KEY ("donorOrganisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_match_applications" ADD CONSTRAINT "FK_levy_match_applications_recipientOrganisationId" FOREIGN KEY ("recipientOrganisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_match_applications_donor_status" ON "levy_match_applications" ("donorOrganisationId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_match_applications_recipient_status" ON "levy_match_applications" ("recipientOrganisationId", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_waiting_pool_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enteredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_levy_waiting_pool_entries" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_waiting_pool_entries" ADD CONSTRAINT "FK_levy_waiting_pool_entries_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_waiting_pool_active_org" ON "levy_waiting_pool_entries" ("organisationId") WHERE "isDeleted" = false AND "active" = true`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    const orgScopedTables = [
      'levy_recipient_profiles',
      'levy_transfer_preferences',
      'levy_waiting_pool_entries',
    ] as const;

    for (const table of orgScopedTables) {
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

    await queryRunner.query(`
CREATE POLICY levy_match_applications_select ON levy_match_applications
  FOR SELECT
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(`
CREATE POLICY levy_match_applications_insert ON levy_match_applications
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(`
CREATE POLICY levy_match_applications_update ON levy_match_applications
  FOR UPDATE
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )
  WITH CHECK (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(`
CREATE POLICY levy_match_applications_delete ON levy_match_applications
  FOR DELETE
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(
      `ALTER TABLE levy_match_applications ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_match_applications FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE levy_match_applications NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_match_applications DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_match_applications_delete ON levy_match_applications`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_match_applications_update ON levy_match_applications`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_match_applications_insert ON levy_match_applications`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_match_applications_select ON levy_match_applications`,
    );

    for (const table of [
      'levy_waiting_pool_entries',
      'levy_transfer_preferences',
      'levy_recipient_profiles',
    ]) {
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

    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_waiting_pool_active_org"`,
    );
    await queryRunner.query(`DROP TABLE "levy_waiting_pool_entries"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_levy_match_applications_recipient_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_levy_match_applications_donor_status"`,
    );
    await queryRunner.query(`DROP TABLE "levy_match_applications"`);

    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_transfer_preferences_org"`,
    );
    await queryRunner.query(`DROP TABLE "levy_transfer_preferences"`);

    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_recipient_profiles_org"`,
    );
    await queryRunner.query(`DROP TABLE "levy_recipient_profiles"`);

    await queryRunner.query(`DROP TYPE "levy_match_application_status"`);
  }
}
