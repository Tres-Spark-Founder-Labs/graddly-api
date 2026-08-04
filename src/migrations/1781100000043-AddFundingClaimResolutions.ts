import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.3.2 AC7 — "funding claim tracker shows: claimed amount, received amount,
 * any discrepancies, and resolution status".
 *
 * Three of those four were already answerable and are not stored here.
 * `claimed` is `enrolments.agreedPrice`; `received` is the sum of
 * `das_funding_payments` for the enrolment; the discrepancy is the comparison
 * plus any clawback notice. Persisting copies of derived numbers is how a
 * tracker starts disagreeing with the payments it tracks, so the service
 * computes them on read.
 *
 * The fourth cannot be derived. Whether a provider has chased a shortfall,
 * accepted it, or is still investigating is a fact about what a person did,
 * and this table holds only that.
 *
 * Rows are created on first engagement rather than one per enrolment up
 * front. "No row" means open and untouched, which is the right default for a
 * claim nobody has looked at; seeding a row per enrolment would fill the
 * table with records asserting that nothing has happened, and make "how many
 * open claims" a question about our seeding rather than about the provider.
 */
export class AddFundingClaimResolutions1781100000043 implements MigrationInterface {
  name = 'AddFundingClaimResolutions1781100000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "funding_claim_resolution_status" AS ENUM (
        'open',
        'investigating',
        'resolved',
        'written_off'
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "funding_claim_resolutions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "status" "funding_claim_resolution_status" NOT NULL DEFAULT 'open',
        "note" text,
        "updatedByUserId" uuid,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_funding_claim_resolutions" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "funding_claim_resolutions" ADD CONSTRAINT "FK_funding_claim_resolutions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "funding_claim_resolutions" ADD CONSTRAINT "FK_funding_claim_resolutions_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // SET NULL: a departed staff member must not erase the record of how a
    // funding discrepancy was closed.
    await queryRunner.query(
      `ALTER TABLE "funding_claim_resolutions" ADD CONSTRAINT "FK_funding_claim_resolutions_updatedByUserId" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /**
     * One resolution per enrolment, enforced. A funding claim has one current
     * state; two rows would make "is this resolved" a question with two
     * answers, and the tracker would show whichever the query happened to
     * return first.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_funding_claim_resolutions_enrolment" ON "funding_claim_resolutions" ("enrolmentId") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_funding_claim_resolutions_org_status" ON "funding_claim_resolutions" ("organisationId", "status")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const [name, clause] of [
      ['select', 'FOR SELECT\n  USING'],
      ['insert', 'FOR INSERT\n  WITH CHECK'],
      ['delete', 'FOR DELETE\n  USING'],
    ] as const) {
      await queryRunner.query(`
CREATE POLICY funding_claim_resolutions_${name} ON funding_claim_resolutions
  ${clause} (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    }

    await queryRunner.query(`
CREATE POLICY funding_claim_resolutions_update ON funding_claim_resolutions
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE funding_claim_resolutions ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE funding_claim_resolutions FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE funding_claim_resolutions NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE funding_claim_resolutions DISABLE ROW LEVEL SECURITY`,
    );
    for (const policy of [
      'funding_claim_resolutions_update',
      'funding_claim_resolutions_delete',
      'funding_claim_resolutions_insert',
      'funding_claim_resolutions_select',
    ]) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${policy} ON funding_claim_resolutions`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_funding_claim_resolutions_org_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_funding_claim_resolutions_enrolment"`,
    );
    await queryRunner.query(`DROP TABLE "funding_claim_resolutions"`);
    await queryRunner.query(`DROP TYPE "funding_claim_resolution_status"`);
  }
}
