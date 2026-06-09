import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateLevyTransferTables1780500000003 implements MigrationInterface {
  name = 'CreateLevyTransferTables1780500000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "levy_transfer_status" AS ENUM ('draft', 'pending_signatures', 'pending_esfa', 'confirmed', 'active', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "levy_transfer_party" AS ENUM ('donor', 'recipient')`,
    );
    await queryRunner.query(
      `CREATE TYPE "levy_transfer_document_status" AS ENUM ('pending', 'ready', 'signed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "donorOrganisationId" uuid NOT NULL,
        "recipientOrganisationId" uuid NOT NULL,
        "matchApplicationId" uuid,
        "amount" numeric(14,2) NOT NULL,
        "programmeDetails" jsonb,
        "esfaTransferReference" character varying(100),
        "status" "levy_transfer_status" NOT NULL DEFAULT 'draft',
        "startDate" date,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "expiryDate" date,
        "dasStatusPayload" jsonb,
        CONSTRAINT "PK_levy_transfers" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfers" ADD CONSTRAINT "FK_levy_transfers_donorOrganisationId" FOREIGN KEY ("donorOrganisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfers" ADD CONSTRAINT "FK_levy_transfers_recipientOrganisationId" FOREIGN KEY ("recipientOrganisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_transfers_donor_status" ON "levy_transfers" ("donorOrganisationId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_transfers_recipient_status" ON "levy_transfers" ("recipientOrganisationId", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_transfer_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "transferId" uuid NOT NULL,
        "pdfJobId" uuid,
        "unsignedStorageKey" character varying(500),
        "signedStorageKey" character varying(500),
        "status" "levy_transfer_document_status" NOT NULL DEFAULT 'pending',
        CONSTRAINT "PK_levy_transfer_documents" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_documents" ADD CONSTRAINT "FK_levy_transfer_documents_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_documents" ADD CONSTRAINT "FK_levy_transfer_documents_transferId" FOREIGN KEY ("transferId") REFERENCES "levy_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_transfer_documents_transfer" ON "levy_transfer_documents" ("transferId") WHERE "isDeleted" = false`,
    );

    await queryRunner.query(
      `CREATE TABLE "levy_transfer_signatures" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "transferId" uuid NOT NULL,
        "party" "levy_transfer_party" NOT NULL,
        "userId" uuid NOT NULL,
        "signatureRecordId" uuid,
        "signedAt" TIMESTAMP WITH TIME ZONE,
        "signOrder" integer NOT NULL,
        CONSTRAINT "PK_levy_transfer_signatures" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_signatures" ADD CONSTRAINT "FK_levy_transfer_signatures_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_signatures" ADD CONSTRAINT "FK_levy_transfer_signatures_transferId" FOREIGN KEY ("transferId") REFERENCES "levy_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_transfer_signatures_party" ON "levy_transfer_signatures" ("transferId", "party") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY levy_transfers_select ON levy_transfers
  FOR SELECT
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(`
CREATE POLICY levy_transfers_insert ON levy_transfers
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(`
CREATE POLICY levy_transfers_update ON levy_transfers
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
CREATE POLICY levy_transfers_delete ON levy_transfers
  FOR DELETE
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR "recipientOrganisationId" = app_current_org()
  )`);

    await queryRunner.query(
      `ALTER TABLE levy_transfers ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_transfers FORCE ROW LEVEL SECURITY`,
    );

    for (const table of [
      'levy_transfer_documents',
      'levy_transfer_signatures',
    ] as const) {
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
      'levy_transfer_signatures',
      'levy_transfer_documents',
    ] as const) {
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
      `ALTER TABLE levy_transfers NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_transfers DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfers_delete ON levy_transfers`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfers_update ON levy_transfers`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfers_insert ON levy_transfers`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfers_select ON levy_transfers`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_transfer_signatures_party"`,
    );
    await queryRunner.query(`DROP TABLE "levy_transfer_signatures"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_levy_transfer_documents_transfer"`,
    );
    await queryRunner.query(`DROP TABLE "levy_transfer_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_levy_transfers_recipient_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_levy_transfers_donor_status"`,
    );
    await queryRunner.query(`DROP TABLE "levy_transfers"`);
    await queryRunner.query(`DROP TYPE "levy_transfer_document_status"`);
    await queryRunner.query(`DROP TYPE "levy_transfer_party"`);
    await queryRunner.query(`DROP TYPE "levy_transfer_status"`);
  }
}
