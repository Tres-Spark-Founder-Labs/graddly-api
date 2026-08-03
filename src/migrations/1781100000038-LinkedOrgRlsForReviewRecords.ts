import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.2.3 AC6 — "employer ... can view the full record".
 *
 * `1781100000018-LinkedOrgRlsForOtjAndReviews` already gave the linked
 * employer SELECT on `reviews`. It stopped at the review row: `review_records`
 * — the SMART goals, wellbeing check, OTJ discussion and action points, which
 * is what "the full record" actually means — kept only the owner-scoped
 * policy, and records are stamped with the *provider's* organisation.
 *
 * So an employer could see that a review happened and not what was said in it.
 * Worse, the employer is already notified when a review completes
 * (`notifyCompletion` includes `employerManagerUserId`), so they were told
 * about a document that returned 404 when they followed it.
 *
 * **This does not reproduce in development.** The local database connects as
 * `graddly`, a superuser, for whom row-level security is not enforced. Every
 * row is visible and the gap stays invisible until an environment runs as the
 * application role. Same trap as 1781100000031.
 *
 * Read only, reached through the review and its enrolment. Nothing here lets
 * an employer write: the record is the provider's account of a conversation,
 * and AC6 asks that the employer can see it, not amend it.
 */
export class LinkedOrgRlsForReviewRecords1781100000038 implements MigrationInterface {
  name = 'LinkedOrgRlsForReviewRecords1781100000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Permissive policies are OR'd, so this is additive: the provider's
    // existing owner-scoped rule keeps working unchanged.
    await queryRunner.query(`
CREATE POLICY review_records_select_linked_org
  ON review_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM reviews r
      JOIN enrolments e ON e.id = r."enrolmentId"
      WHERE r.id = review_records."reviewId"
        AND r."isDeleted" = false
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
      `DROP POLICY IF EXISTS review_records_select_linked_org ON review_records`,
    );
  }
}
