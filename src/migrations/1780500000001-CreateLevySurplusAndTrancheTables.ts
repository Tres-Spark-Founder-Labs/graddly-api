import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateLevySurplusAndTrancheTables1780500000001 implements MigrationInterface {
  name = 'CreateLevySurplusAndTrancheTables1780500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "levy_expiry_alert_type" AS ENUM ('days_90', 'days_30')`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_levy_tranches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "donorLinkId" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "expiresOn" date NOT NULL,
        "rawPayload" jsonb,
        CONSTRAINT "PK_das_levy_tranches" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "das_levy_tranches" ADD CONSTRAINT "FK_das_levy_tranches_donorLinkId" FOREIGN KEY ("donorLinkId") REFERENCES "das_donor_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_das_levy_tranches_link_expires" ON "das_levy_tranches" ("donorLinkId", "expiresOn")`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_surplus_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "donorLinkId" uuid NOT NULL,
        "totalBalance" numeric(14,2) NOT NULL,
        "committedToOwnApprenticeships" numeric(14,2) NOT NULL,
        "maxTransferable" numeric(14,2) NOT NULL,
        "alreadyTransferred" numeric(14,2) NOT NULL,
        "availableSurplus" numeric(14,2) NOT NULL,
        "computedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_levy_surplus_snapshots" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "levy_surplus_snapshots" ADD CONSTRAINT "FK_levy_surplus_snapshots_donorLinkId" FOREIGN KEY ("donorLinkId") REFERENCES "das_donor_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_surplus_snapshots_org_computed" ON "levy_surplus_snapshots" ("organisationId", "computedAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_expiry_alert_dispatches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "donorLinkId" uuid NOT NULL,
        "trancheId" uuid NOT NULL,
        "alertType" "levy_expiry_alert_type" NOT NULL,
        "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_levy_expiry_alert_dispatches" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "levy_expiry_alert_dispatches" ADD CONSTRAINT "FK_levy_expiry_alert_dispatches_donorLinkId" FOREIGN KEY ("donorLinkId") REFERENCES "das_donor_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_expiry_alert_dispatches" ADD CONSTRAINT "FK_levy_expiry_alert_dispatches_trancheId" FOREIGN KEY ("trancheId") REFERENCES "das_levy_tranches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_expiry_alert_dispatches" ON "levy_expiry_alert_dispatches" ("trancheId", "alertType") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'das_levy_tranches',
      'levy_surplus_snapshots',
      'levy_expiry_alert_dispatches',
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
      'levy_expiry_alert_dispatches',
      'levy_surplus_snapshots',
      'das_levy_tranches',
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

    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_expiry_alert_dispatches"`,
    );
    await queryRunner.query(`DROP TABLE "levy_expiry_alert_dispatches"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_levy_surplus_snapshots_org_computed"`,
    );
    await queryRunner.query(`DROP TABLE "levy_surplus_snapshots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_das_levy_tranches_link_expires"`,
    );
    await queryRunner.query(`DROP TABLE "das_levy_tranches"`);
    await queryRunner.query(`DROP TYPE "levy_expiry_alert_type"`);
  }
}
