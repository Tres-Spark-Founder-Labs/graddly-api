import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.1 / F1.2.2 — let an employer read the OTJ logs and reviews belonging to
 * their own apprentices.
 *
 * Context. `EnrolmentsRlsLinkedOrganisations` (1781100000015) extended the
 * enrolments SELECT policy so the linked employer and provider organisations
 * can read an enrolment they are party to. It stopped there. Every child
 * record — OTJ entries, reviews — is still visible only to the organisation
 * that owns it, which in practice is the training provider.
 *
 * The effect is that an employer can see that an enrolment exists but nothing
 * underneath it: no off-the-job hours, so no OTJ progress percentage and no
 * pace-derived status badge, and no review history. Those are the substance of
 * both the employer roster and the learner profile.
 *
 * This finishes what that migration started, using the same "or a linked
 * organisation" shape, reached through the enrolment rather than duplicated
 * onto every child row. Reading is widened; writing is not — INSERT, UPDATE
 * and DELETE policies are deliberately untouched, so an employer still cannot
 * create or alter a provider's OTJ records. Approving an OTJ entry goes
 * through the service layer's own role checks, not through RLS.
 *
 * Scope note: the subquery matches only enrolments where the caller is the
 * named employer or provider. An unrelated organisation gains nothing.
 */
const LINKED_ORG_TABLES = ['otj_log_entries', 'reviews'] as const;

export class LinkedOrgRlsForOtjAndReviews1781100000018 implements MigrationInterface {
  name = 'LinkedOrgRlsForOtjAndReviews1781100000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of LINKED_ORG_TABLES) {
      // Additive: a second permissive SELECT policy. Postgres ORs permissive
      // policies together, so the existing owner-scoped rule is untouched and
      // a row remains visible to its owner exactly as before.
      await queryRunner.query(`
CREATE POLICY ${table}_select_linked_org ON ${table}
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e.id = ${table}."enrolmentId"
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of LINKED_ORG_TABLES) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_select_linked_org ON ${table}`,
      );
    }
  }
}
