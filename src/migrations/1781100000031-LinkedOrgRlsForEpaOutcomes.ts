import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.4.1 AC1 — let an employer read the EPA outcomes of their own apprentices.
 *
 * The fourth appearance of the same pattern, after F1.2.2, F1.3.1 and F1.3.2.
 * `epa_outcomes` carries the standard owner-scoped SELECT policy:
 *
 *     USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
 *
 * and `EnrolmentsService.recordEpaOutcome` stamps `organisationId` with
 * `user.organisationId` — whoever recorded the assessment. End-point
 * assessment is arranged by the training provider, so the owning organisation
 * is the provider.
 *
 * The consequence is specific and silent: an employer's ROI report would
 * compute an EPA pass rate over zero visible rows and report "no apprentices
 * assessed yet" — for apprentices who have been assessed, whose outcomes are
 * sitting in the table. Not an error, not an empty state anyone would
 * question. Just a permanently absent number on the board report that AC1
 * names explicitly.
 *
 * **This would not have shown up in development.** The local database
 * connects as `graddly`, a superuser, for whom row-level security is not
 * enforced at all — so the query returns every row and the report looks
 * correct right up until it reaches an environment that runs as the
 * application role.
 *
 * Read only, and reachable via the enrolment, matching 1781100000024. Nothing
 * here lets an employer record or alter an assessment outcome: that is the
 * provider's to state, and widening writes on an assessment result is not a
 * side effect a reporting feature should have.
 */
export class LinkedOrgRlsForEpaOutcomes1781100000031 implements MigrationInterface {
  name = 'LinkedOrgRlsForEpaOutcomes1781100000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permissive policies are OR'd, so this is additive: the existing
    // owner-scoped rule keeps working unchanged for the provider.
    await queryRunner.query(`
CREATE POLICY epa_outcomes_select_linked_org
  ON epa_outcomes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e.id = epa_outcomes."enrolmentId"
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
      `DROP POLICY IF EXISTS epa_outcomes_select_linked_org ON epa_outcomes`,
    );
  }
}
