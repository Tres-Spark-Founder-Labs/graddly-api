import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class AddDasReportingTables1781100000012 implements MigrationInterface {
  name = 'AddDasReportingTables1781100000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "das_levy_balances" ADD "utilisationSegments" jsonb`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_levy_monthly_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "month" date NOT NULL,
        "contributions" numeric(14,2) NOT NULL DEFAULT 0,
        "spend" numeric(14,2) NOT NULL DEFAULT 0,
        "currency" character varying(3) NOT NULL DEFAULT 'GBP',
        CONSTRAINT "PK_das_levy_monthly_entries" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "das_levy_monthly_entries" ADD CONSTRAINT "FK_das_levy_monthly_entries_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_das_levy_monthly_entries_org_month" ON "das_levy_monthly_entries" ("organisationId", "month") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_funding_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid,
        "paymentDate" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'GBP',
        "fundingPeriod" character varying(32),
        "clawbackNotice" text,
        "externalReference" character varying(128) NOT NULL,
        "rawPayload" jsonb,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_das_funding_payments" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "das_funding_payments" ADD CONSTRAINT "FK_das_funding_payments_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "das_funding_payments" ADD CONSTRAINT "FK_das_funding_payments_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_das_funding_payments_org_external_ref" ON "das_funding_payments" ("organisationId", "externalReference") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of ['das_levy_monthly_entries', 'das_funding_payments']) {
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
    for (const table of ['das_funding_payments', 'das_levy_monthly_entries']) {
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
      `DROP INDEX "public"."UQ_das_funding_payments_org_external_ref"`,
    );
    await queryRunner.query(`DROP TABLE "das_funding_payments"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_das_levy_monthly_entries_org_month"`,
    );
    await queryRunner.query(`DROP TABLE "das_levy_monthly_entries"`);
    await queryRunner.query(
      `ALTER TABLE "das_levy_balances" DROP COLUMN "utilisationSegments"`,
    );
  }
}
