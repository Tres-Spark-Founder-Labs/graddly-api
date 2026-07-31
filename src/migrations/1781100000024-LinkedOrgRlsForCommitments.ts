import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.1 — let an employer read the commitment statements they are a party to.
 *
 * Same blocker as F1.2.2, one table family further on. The SELECT policies on
 * `commitment_statement_groups`, `commitment_statements` and
 * `commitment_signatures` are all owner-scoped:
 *
 *     USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
 *
 * Commitment statements are created by the training provider, so the owning
 * organisation is the provider. An employer therefore cannot read a single
 * row of the very document they are legally required to sign — and F1.3.1
 * asks for a board listing every one of them, showing which need the
 * employer's signature.
 *
 * The reachability differs per table, so each policy walks its own path back
 * to the enrolment rather than duplicating an `enrolmentId` column onto rows
 * that do not have one:
 *
 *     groups      → enrolments (groups."enrolmentId")
 *     statements  → groups → enrolments
 *     signatures  → statements → groups → enrolments
 *
 * Read only. INSERT, UPDATE and DELETE are deliberately untouched, exactly as
 * in 1781100000018: this makes the board visible, and nothing else. Employer
 * signing writes to `commitment_signatures` and needs its own decision — the
 * service layer's `sign` endpoint enforces party and role, but the row-level
 * write policy would have to be widened too, and widening writes on a legal
 * document deserves to be its own change rather than a side effect of adding
 * a status board.
 */
export class LinkedOrgRlsForCommitments1781100000024 implements MigrationInterface {
  name = 'LinkedOrgRlsForCommitments1781100000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permissive policies are OR'd by Postgres, so each of these is additive:
    // the existing owner-scoped rule keeps working unchanged.
    await queryRunner.query(`
CREATE POLICY commitment_statement_groups_select_linked_org
  ON commitment_statement_groups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e.id = commitment_statement_groups."enrolmentId"
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);

    await queryRunner.query(`
CREATE POLICY commitment_statements_select_linked_org
  ON commitment_statements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM commitment_statement_groups g
      JOIN enrolments e ON e.id = g."enrolmentId"
      WHERE g.id = commitment_statements."groupId"
        AND g."isDeleted" = false
        AND e."isDeleted" = false
        -- (commitment_statements itself has no isDeleted column)
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);

    await queryRunner.query(`
CREATE POLICY commitment_signatures_select_linked_org
  ON commitment_signatures
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM commitment_statements s
      JOIN commitment_statement_groups g ON g.id = s."groupId"
      JOIN enrolments e ON e.id = g."enrolmentId"
      WHERE s.id = commitment_signatures."statementId"
        -- No isDeleted check on the statement: only
        -- commitment_statement_groups carries that column. Statements are
        -- superseded by version rather than soft-deleted, and signatures are
        -- not soft-deleted at all. Checked against information_schema rather
        -- than assumed from the other policies.
        AND g."isDeleted" = false
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_signatures_select_linked_org ON commitment_signatures`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_statements_select_linked_org ON commitment_statements`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_statement_groups_select_linked_org ON commitment_statement_groups`,
    );
  }
}
