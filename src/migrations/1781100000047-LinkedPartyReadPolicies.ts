import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * Security hardening pass, item 1 — linked-party read policies.
 *
 * Five tables were readable only by their owning organisation while a second
 * party legitimately needed to read them. Each was confirmed by connecting as
 * `graddly_app` (NOSUPERUSER) with a three-organisation fixture and observing
 * zero rows — see `test/linked-party-rls.e2e-spec.ts`. None of them reproduce
 * locally, because the dev database connects as a superuser for whom RLS is
 * not enforced.
 *
 * | Table                    | Non-owning reader        | Symptom before |
 * |--------------------------|--------------------------|----------------|
 * | `apprentices`            | linked employer          | every learner name blank |
 * | `review_signatures`      | linked employer          | "nobody has signed" |
 * | `message_threads`        | thread counterparty      | empty inbox |
 * | `messages`               | thread counterparty      | empty thread |
 * | `employer_visit_learners`| visited employer         | a visit that discussed nobody |
 *
 * EVERY POLICY HERE IS ADDITIVE. Postgres OR's permissive policies together,
 * so each of these sits alongside the existing owner rule rather than
 * replacing it. The owner rule is never widened, and no existing policy is
 * dropped — that is what makes this safe to apply to a live database.
 *
 * SELECT ONLY. Reads widen; writes stay exactly as narrow as they were. The
 * accompanying test asserts an UPDATE by the linked party still affects zero
 * rows, because a read policy that quietly enabled writes would be a far worse
 * bug than the one being fixed.
 */
export class LinkedPartyReadPolicies1781100000047 implements MigrationInterface {
  name = 'LinkedPartyReadPolicies1781100000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureRlsHelperFunctions(queryRunner);

    /**
     * `apprentices` — the employer's own employee.
     *
     * The apprentice row is stamped with whichever organisation created it.
     * The other party to the enrolment is then locked out of the learner's
     * name, which is on every screen either portal shows.
     */
    await queryRunner.query(`
CREATE POLICY apprentices_select_linked_org ON apprentices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e."apprenticeId" = apprentices.id
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);

    /**
     * `review_signatures` — who signed the review.
     *
     * `reviews` (migration 18) and `review_records` (migration 38) already
     * carry linked-org SELECT. The signatures did not, so the employer could
     * read a completed review and its full record while its signature block
     * appeared empty — which reads as "nobody has signed this", a different
     * and worse claim than "you may not see this".
     */
    await queryRunner.query(`
CREATE POLICY review_signatures_select_linked_org ON review_signatures
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM reviews r
      JOIN enrolments e ON e.id = r."enrolmentId"
      WHERE r.id = review_signatures."reviewId"
        AND r."isDeleted" = false
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);

    /**
     * `message_threads` — scoped to the participants, not to an organisation.
     *
     * A thread is stamped with the enrolment's owning organisation, but its
     * two participants are an apprentice and either a tutor or an employer
     * manager. The employer manager's active organisation is the employer, so
     * the owner rule excluded them and their inbox was empty.
     *
     * Deliberately keyed on `app_current_user()` rather than on the employer
     * organisation. `MessagingAccessService.isParticipant` authorises exactly
     * these two users, so this matches the service rule rather than inventing
     * a wider one — a private message between two people should not become
     * readable by everyone at their employer.
     *
     * This is narrower than the service's `isAdmin` arm, which also lets an
     * owner/admin read any thread. That still works for the owning
     * organisation via the existing policy. Whether a *linked* organisation's
     * admins should read their staff's message threads is a privacy decision,
     * not an engineering one — raised in DECISIONS-FOR-CLIENT.md, with the
     * narrower behaviour implemented meanwhile.
     */
    await queryRunner.query(`
CREATE POLICY message_threads_select_participant ON message_threads
  FOR SELECT
  USING (
    "apprenticeUserId" = app_current_user()
    OR "counterpartyUserId" = app_current_user()
  )`);

    /** `messages` — same participants, resolved through the thread. */
    await queryRunner.query(`
CREATE POLICY messages_select_participant ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM message_threads t
      WHERE t.id = messages."threadId"
        AND t."isDeleted" = false
        AND (
          t."apprenticeUserId" = app_current_user()
          OR t."counterpartyUserId" = app_current_user()
        )
    )
  )`);

    /**
     * `employer_visit_learners` — who was discussed.
     *
     * `employer_visits` already lets the visited employer read the visit
     * (migration 44). The join table naming the learners did not, so the
     * employer saw a visit that had apparently discussed nobody.
     */
    await queryRunner.query(`
CREATE POLICY employer_visit_learners_select_employer ON employer_visit_learners
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM employer_visits v
      WHERE v.id = employer_visit_learners."visitId"
        AND v."isDeleted" = false
        AND v."employerOrganisationId" = app_current_org()
    )
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, policy] of [
      ['apprentices', 'apprentices_select_linked_org'],
      ['review_signatures', 'review_signatures_select_linked_org'],
      ['message_threads', 'message_threads_select_participant'],
      ['messages', 'messages_select_participant'],
      ['employer_visit_learners', 'employer_visit_learners_select_employer'],
    ] as const) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    }
  }
}
