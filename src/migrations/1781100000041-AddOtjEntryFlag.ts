import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.2.4 AC3 — "tutor can flag entries".
 *
 * There was no way to flag one. `otj_log_entries` carried an approval status
 * — pending, approved, rejected — and nothing else. Those are the employer's
 * decision about whether hours count; a tutor's flag is a different act with
 * a different audience.
 *
 * A tutor reading a learner's log wants to mark *"this one needs a
 * conversation"* — hours that look implausible, an activity that is not
 * off-the-job, a session logged for a day the learner was absent — without
 * rejecting it. Rejecting is the employer's call and removes the hours;
 * flagging keeps them and starts a discussion.
 *
 * Three columns rather than a boolean, because a flag nobody can explain is
 * an accusation. The note says why, and the tutor and time say who raised it
 * and when — a flag with no author is not something a learner can respond to.
 */
export class AddOtjEntryFlag1781100000041 implements MigrationInterface {
  name = 'AddOtjEntryFlag1781100000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "flaggedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "flaggedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "flagNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD CONSTRAINT "FK_otj_log_entries_flaggedByUserId" FOREIGN KEY ("flaggedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Partial index: the only query anyone runs is "which entries are
    // flagged", and flagged entries are a small minority of the table.
    await queryRunner.query(
      `CREATE INDEX "IDX_otj_log_entries_flagged" ON "otj_log_entries" ("organisationId", "enrolmentId") WHERE "flaggedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_otj_log_entries_flagged"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP CONSTRAINT "FK_otj_log_entries_flaggedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "flagNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "flaggedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "flaggedAt"`,
    );
  }
}
