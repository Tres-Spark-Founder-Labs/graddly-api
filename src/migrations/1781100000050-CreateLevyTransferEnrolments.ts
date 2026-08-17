import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F4.1.4 AC1 — record which enrolments a levy transfer funded.
 *
 * Without this, "number of learners enrolled" on the donor analytics dashboard
 * is not derivable: a transfer knows its amount, donor and recipient, but not
 * which learners the money paid for. See `PORTAL4-REMAINING-SPEC.md`.
 *
 * ── ROW-LEVEL SECURITY ──────────────────────────────────────────────────────
 *
 * Three parties have a legitimate interest in one of these rows and they are
 * not the same organisation:
 *
 *   • the **donor**, who paid — matched on `donorOrganisationId`;
 *   • the **recipient SME**, whose learner it is — reached through the
 *     transfer's `recipientOrganisationId`;
 *   • the **provider**, who delivers the training and owns the enrolment row —
 *     reached through `enrolments.organisationId`.
 *
 * The donor predicate is a direct column comparison because
 * `donorOrganisationId` is denormalised onto this table. The other two have to
 * traverse, and are written as `EXISTS` subqueries rather than joins so the
 * policy stays a predicate on this row.
 *
 * Insert is deliberately narrower than select: only the provider who owns the
 * enrolment may create the link. A donor must not be able to attribute
 * arbitrary learners to their own transfer, because that number is published.
 */
export class CreateLevyTransferEnrolments1781100000050 implements MigrationInterface {
  name = 'CreateLevyTransferEnrolments1781100000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "levy_transfer_enrolments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "transferId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "donorOrganisationId" uuid NOT NULL,
        "attributedAmount" numeric(14,2),
        CONSTRAINT "PK_levy_transfer_enrolments" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "levy_transfer_enrolments" ADD CONSTRAINT "FK_levy_transfer_enrolments_transferId" FOREIGN KEY ("transferId") REFERENCES "levy_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_enrolments" ADD CONSTRAINT "FK_levy_transfer_enrolments_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_enrolments" ADD CONSTRAINT "FK_levy_transfer_enrolments_donorOrganisationId" FOREIGN KEY ("donorOrganisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_levy_transfer_enrolments_transfer" ON "levy_transfer_enrolments" ("transferId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_transfer_enrolments_enrolment" ON "levy_transfer_enrolments" ("enrolmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_transfer_enrolments_donor" ON "levy_transfer_enrolments" ("donorOrganisationId")`,
    );

    /**
     * The pair is unique among live rows. Without it a repeated call would
     * record the same learner twice and inflate a published figure — the one
     * failure mode this table exists to prevent.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_levy_transfer_enrolments_pair" ON "levy_transfer_enrolments" ("transferId", "enrolmentId") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY levy_transfer_enrolments_select ON levy_transfer_enrolments
  FOR SELECT
  USING (
    app_rls_bootstrap()
    OR "donorOrganisationId" = app_current_org()
    OR EXISTS (
      SELECT 1 FROM levy_transfers t
      WHERE t.id = levy_transfer_enrolments."transferId"
        AND t."recipientOrganisationId" = app_current_org()
    )
    OR EXISTS (
      SELECT 1 FROM enrolments e
      WHERE e.id = levy_transfer_enrolments."enrolmentId"
        AND e."organisationId" = app_current_org()
    )
  )`);

    await queryRunner.query(`
CREATE POLICY levy_transfer_enrolments_insert ON levy_transfer_enrolments
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR EXISTS (
      SELECT 1 FROM enrolments e
      WHERE e.id = levy_transfer_enrolments."enrolmentId"
        AND e."organisationId" = app_current_org()
    )
  )`);

    await queryRunner.query(`
CREATE POLICY levy_transfer_enrolments_update ON levy_transfer_enrolments
  FOR UPDATE
  USING (
    app_rls_bootstrap()
    OR EXISTS (
      SELECT 1 FROM enrolments e
      WHERE e.id = levy_transfer_enrolments."enrolmentId"
        AND e."organisationId" = app_current_org()
    )
  )
  WITH CHECK (
    app_rls_bootstrap()
    OR EXISTS (
      SELECT 1 FROM enrolments e
      WHERE e.id = levy_transfer_enrolments."enrolmentId"
        AND e."organisationId" = app_current_org()
    )
  )`);

    await queryRunner.query(
      `ALTER TABLE levy_transfer_enrolments ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_transfer_enrolments FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE levy_transfer_enrolments NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE levy_transfer_enrolments DISABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfer_enrolments_update ON levy_transfer_enrolments`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfer_enrolments_insert ON levy_transfer_enrolments`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_transfer_enrolments_select ON levy_transfer_enrolments`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "levy_transfer_enrolments"`);
  }
}
