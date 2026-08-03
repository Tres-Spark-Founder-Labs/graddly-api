import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.2.4 AC6 — "provider can record reason, expected return date, and notify
 * DAS" for a break in learning.
 *
 * None of that could be recorded. `LearnerProfileResponseDto` advertises
 * `breakInLearning.reason` and `breakInLearning.expectedReturnDate`, and
 * `learner-profile.service.ts` returned a hardcoded `null` for both, because
 * there was nowhere to put them. A learner could be paused — `ApprenticeStatus
 * .PAUSED` — and nobody could say why or when they were due back. The contract
 * promised two fields that could never hold a value.
 *
 * A table rather than two columns on `apprentices`, for three reasons:
 *
 *  - A break is an event with a start and an end, not a property of a person.
 *    Columns would be overwritten by the next break and lose the first.
 *  - An apprenticeship can have several breaks, and the ESFA cares about all
 *    of them: planned break duration affects funding and expected end date.
 *  - "Did they come back when they said they would" is answerable from
 *    history and unanswerable from current state.
 *
 * `dasNotifiedAt` records that the ILR push was queued, not that the ESFA
 * accepted it — delivery is the push pipeline's business and has its own
 * status. Storing it here keeps the answer to "was DAS told about this break"
 * next to the break rather than requiring a join through the push table.
 */
export class AddBreakInLearning1781100000039 implements MigrationInterface {
  name = 'AddBreakInLearning1781100000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "break_in_learning" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "apprenticeId" uuid NOT NULL,
        "reason" text NOT NULL,
        "startedOn" date NOT NULL,
        "expectedReturnDate" date,
        "actualReturnDate" date,
        "recordedByUserId" uuid,
        "endedByUserId" uuid,
        "dasNotifiedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_break_in_learning" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "break_in_learning" ADD CONSTRAINT "FK_break_in_learning_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "break_in_learning" ADD CONSTRAINT "FK_break_in_learning_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "break_in_learning" ADD CONSTRAINT "FK_break_in_learning_apprenticeId" FOREIGN KEY ("apprenticeId") REFERENCES "apprentices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // SET NULL: deleting a staff account must not delete the record of a
    // break, which is part of the learner's funding history.
    await queryRunner.query(
      `ALTER TABLE "break_in_learning" ADD CONSTRAINT "FK_break_in_learning_recordedByUserId" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "break_in_learning" ADD CONSTRAINT "FK_break_in_learning_endedByUserId" FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /**
     * One open break per enrolment, enforced rather than assumed. Two
     * concurrent breaks is not a state anyone means to create, and without
     * this "the current break" has no single answer — which is exactly what
     * the learner profile has to display.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_break_in_learning_open_per_enrolment" ON "break_in_learning" ("enrolmentId") WHERE "actualReturnDate" IS NULL AND "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_break_in_learning_org_enrolment" ON "break_in_learning" ("organisationId", "enrolmentId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY break_in_learning_select ON break_in_learning
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY break_in_learning_insert ON break_in_learning
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY break_in_learning_update ON break_in_learning
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY break_in_learning_delete ON break_in_learning
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    /**
     * The linked employer sees the break too. They are funding the
     * apprenticeship and the learner works for them — an employer discovering
     * a three-month break from the apprentice rather than the platform is the
     * kind of gap that ends a provider relationship.
     *
     * Read only: recording and ending a break is the provider's act.
     */
    await queryRunner.query(`
CREATE POLICY break_in_learning_select_linked_org ON break_in_learning
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM enrolments e
      WHERE e.id = break_in_learning."enrolmentId"
        AND e."isDeleted" = false
        AND (
          e."employerOrganisationId" = app_current_org()
          OR e."providerOrganisationId" = app_current_org()
        )
    )
  )`);

    await queryRunner.query(
      `ALTER TABLE break_in_learning ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE break_in_learning FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE break_in_learning NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE break_in_learning DISABLE ROW LEVEL SECURITY`,
    );
    for (const policy of [
      'break_in_learning_select_linked_org',
      'break_in_learning_delete',
      'break_in_learning_update',
      'break_in_learning_insert',
      'break_in_learning_select',
    ]) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${policy} ON break_in_learning`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_break_in_learning_org_enrolment"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_break_in_learning_open_per_enrolment"`,
    );
    await queryRunner.query(`DROP TABLE "break_in_learning"`);
  }
}
