import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * Security hardening pass, item 2 — the two tables that still shut the
 * employer out of their own learner's profile.
 *
 * Migration 1781100000047 widened five tables for the linked party and left
 * these two owner-only, because the screens audited then did not reach them.
 * `GET /learners/:enrolmentId/profile` does: it joins the standard for
 * `programme.standardTitle` and lists intervention actions under
 * `breakInLearning.recentInterventions`.
 *
 * | Table                  | Non-owning reader | Symptom before |
 * |------------------------|-------------------|----------------|
 * | `standards`            | linked employer   | `enrolment.standard` null, and the aggregate throws on `.title` |
 * | `intervention_actions` | linked employer   | interventions list empty, reading as "nothing was ever raised" |
 *
 * Neither reproduces on a dev database, which connects as a superuser for whom
 * RLS is not enforced. They reproduce as `graddly_app`.
 *
 * EMPLOYER ONLY, unlike the policies in 47, which admit either party. A
 * provider already reads its own standards and intervention actions through
 * the existing `standards_select` / `intervention_actions_select` rules on
 * `organisationId`, so adding the provider arm here would widen nothing and
 * only invite the reader to think it does something.
 *
 * ADDITIVE, AND SELECT ONLY. Postgres ORs permissive policies together, so
 * each of these sits alongside the owner rule rather than replacing it. No
 * existing policy is dropped or widened, and nothing here grants a write.
 *
 * ── A KNOWN PROPERTY, NOT A BUG TO FIX HERE ─────────────────────────────────
 *
 * Both predicates filter `e."isDeleted" = false` and say nothing about
 * `e.status`. An employer whose apprentice has withdrawn, or whose enrolment
 * completed years ago, therefore keeps read access for as long as the
 * enrolment row survives. That is already true of
 * `apprentices_select_linked_org` from migration 47 and of
 * `enrolments_select` from 15 — this migration inherits the property rather
 * than introducing it, and diverging from them here would leave the employer
 * able to read the learner's name and not their standard, which is a stranger
 * state than either. Whether linked-party reads should expire with the
 * enrolment is a retention decision, not an engineering one.
 */
export class EmployerLinkedPartyProfileReads1781100000054 implements MigrationInterface {
  name = 'EmployerLinkedPartyProfileReads1781100000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureRlsHelperFunctions(queryRunner);

    /**
     * `standards` — the programme the employer's own apprentice is on.
     *
     * A standard is stamped with the provider that created it. The employer
     * has no standards of their own, so the owner rule matched nothing and
     * `relations: ['standard']` resolved to null on every profile read.
     */
    await queryRunner.query(`
CREATE POLICY standards_select_linked_org ON standards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e."standardId" = standards.id
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
  )`);

    /**
     * `intervention_actions` — what the provider has done about a learner at
     * risk.
     *
     * Keyed through the enrolment rather than on the action's own
     * `organisationId`, which is the provider's. An empty list is the
     * dangerous shape here: it reads as "no intervention was ever raised"
     * rather than "you may not see these", and that is the opposite of what
     * an employer needs to know about their own employee.
     */
    await queryRunner.query(`
CREATE POLICY intervention_actions_select_linked_org ON intervention_actions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e.id = intervention_actions."enrolmentId"
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
  )`);

    /**
     * Both policies above, and `apprentices_select_linked_org` from migration
     * 47, filter `enrolments` on `employerOrganisationId` alone.
     *
     * `IDX_enrolments_org_employer_org` leads with `organisationId`, so a
     * predicate that does not constrain that column cannot seek it — every
     * linked-party read has been scanning `enrolments` since migration 47.
     * Partial on `isDeleted = false` because every one of these predicates
     * carries that term, matching `IDX_enrolments_active_status`.
     */
    await queryRunner.query(`
      CREATE INDEX "IDX_enrolments_active_employer_org"
      ON "enrolments" ("employerOrganisationId")
      WHERE "isDeleted" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_enrolments_active_employer_org"`,
    );
    for (const [table, policy] of [
      ['standards', 'standards_select_linked_org'],
      ['intervention_actions', 'intervention_actions_select_linked_org'],
    ] as const) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    }
  }
}
