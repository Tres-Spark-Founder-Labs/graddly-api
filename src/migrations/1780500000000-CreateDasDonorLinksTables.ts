import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateDasDonorLinksTables1780500000000 implements MigrationInterface {
  name = 'CreateDasDonorLinksTables1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "das_donor_link_status" AS ENUM ('pending_consent', 'linked', 'error')`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_donor_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "label" character varying(120),
        "dasAccountId" character varying(64),
        "ukprn" character varying(8),
        "status" "das_donor_link_status" NOT NULL DEFAULT 'pending_consent',
        "lastErrorMessage" text,
        "consentedAt" TIMESTAMP WITH TIME ZONE,
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "lastBalance" numeric(14,2),
        "lastRawPayload" jsonb,
        CONSTRAINT "PK_das_donor_links" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "das_donor_links" ADD CONSTRAINT "FK_das_donor_links_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_das_donor_links_org_status" ON "das_donor_links" ("organisationId", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_donor_oauth_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "donorLinkId" uuid NOT NULL,
        "accessTokenEncrypted" text NOT NULL,
        "refreshTokenEncrypted" text,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "scope" character varying(500),
        CONSTRAINT "PK_das_donor_oauth_tokens" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "das_donor_oauth_tokens" ADD CONSTRAINT "FK_das_donor_oauth_tokens_donorLinkId" FOREIGN KEY ("donorLinkId") REFERENCES "das_donor_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_das_donor_oauth_tokens_link" ON "das_donor_oauth_tokens" ("donorLinkId") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY das_donor_links_select ON das_donor_links
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_links_insert ON das_donor_links
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_links_update ON das_donor_links
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_links_delete ON das_donor_links
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE das_donor_links ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_donor_links FORCE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(`
CREATE POLICY das_donor_oauth_tokens_select ON das_donor_oauth_tokens
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_oauth_tokens_insert ON das_donor_oauth_tokens
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_oauth_tokens_update ON das_donor_oauth_tokens
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(`
CREATE POLICY das_donor_oauth_tokens_delete ON das_donor_oauth_tokens
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE das_donor_oauth_tokens ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_donor_oauth_tokens FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE das_donor_oauth_tokens NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_donor_oauth_tokens DISABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_oauth_tokens_delete ON das_donor_oauth_tokens`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_oauth_tokens_update ON das_donor_oauth_tokens`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_oauth_tokens_insert ON das_donor_oauth_tokens`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_oauth_tokens_select ON das_donor_oauth_tokens`,
    );

    await queryRunner.query(
      `ALTER TABLE das_donor_links NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_donor_links DISABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_links_delete ON das_donor_links`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_links_update ON das_donor_links`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_links_insert ON das_donor_links`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS das_donor_links_select ON das_donor_links`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."UQ_das_donor_oauth_tokens_link"`,
    );
    await queryRunner.query(`DROP TABLE "das_donor_oauth_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_das_donor_links_org_status"`,
    );
    await queryRunner.query(`DROP TABLE "das_donor_links"`);
    await queryRunner.query(`DROP TYPE "das_donor_link_status"`);
  }
}
