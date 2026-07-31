import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.2 — let an employer actually record their signature.
 *
 * Migration 1781100000024 opened *reading* commitment statements to the
 * linked employer and deliberately stopped there, on the grounds that
 * widening writes on a legally binding document should be its own decision
 * rather than a side effect of building a status board. Client decision of
 * 31 July 2026 confirms F1.3.2 as specified: the signature is captured in
 * Gradlly, compliant with eIDAS. This is that change.
 *
 * Two tables, and the scope is deliberately tight:
 *
 *  - `commitment_signatures` UPDATE: only the row for the employer's *own*
 *    party (`employer_manager`), and only on a statement whose enrolment
 *    names this organisation as the employer. An employer cannot mark the
 *    provider's or the apprentice's signature as given.
 *
 *  - `signature_records` INSERT: the eIDAS evidence row — timestamp, IP,
 *    user agent. Scoped to rows the organisation owns, which is the normal
 *    tenant rule; nothing about the employer case needs it widened further.
 *
 * `commitment_statements` UPDATE is **not** widened. The transition to
 * `signed` once every party has signed is a system-computed consequence, not
 * something a user edits, so it runs under the RLS bootstrap flag inside the
 * service instead. Opening statement UPDATE to employers would let them alter
 * content and version fields on a document drafted by the provider.
 *
 * Ordering is still enforced above this layer: the sign endpoint rejects an
 * out-of-turn signature, and RLS is not the mechanism for that. This policy
 * governs *whose* row may be written, not *when*.
 */
export class EmployerCommitmentSigningWrites1781100000026 implements MigrationInterface {
  name = 'EmployerCommitmentSigningWrites1781100000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE POLICY commitment_signatures_update_employer_own_party
  ON commitment_signatures
  FOR UPDATE
  USING (
    commitment_signatures.party = 'employer_manager'
    AND EXISTS (
      SELECT 1
      FROM commitment_statements s
      JOIN commitment_statement_groups g ON g.id = s."groupId"
      JOIN enrolments e ON e.id = g."enrolmentId"
      WHERE s.id = commitment_signatures."statementId"
        AND g."isDeleted" = false
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
  )
  WITH CHECK (
    commitment_signatures.party = 'employer_manager'
    AND EXISTS (
      SELECT 1
      FROM commitment_statements s
      JOIN commitment_statement_groups g ON g.id = s."groupId"
      JOIN enrolments e ON e.id = g."enrolmentId"
      WHERE s.id = commitment_signatures."statementId"
        AND g."isDeleted" = false
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
  )`);

    // WITH CHECK as well as USING: without it a row could be read under the
    // policy and then updated into a shape the policy would not have allowed,
    // for instance by rewriting `party`.
    await queryRunner.query(`
CREATE POLICY signature_records_insert_employer
  ON signature_records
  FOR INSERT
  WITH CHECK ("organisationId" = app_current_org())`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS signature_records_insert_employer ON signature_records`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS commitment_signatures_update_employer_own_party ON commitment_signatures`,
    );
  }
}
