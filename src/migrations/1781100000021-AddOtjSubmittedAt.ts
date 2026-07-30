import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.3 AC1 — the approval queue lists each entry's submission date.
 *
 * The entity recorded `approvedAt` and `rejectedAt` but nothing for the
 * submission itself, so the queue showed `loggedDate` — the day the learning
 * happened, not the day it arrived for approval. Those differ whenever an
 * apprentice writes up a session later, and a manager triaging a queue needs
 * to know how long something has been waiting on them, not when it occurred.
 *
 * Backfilled from `createdAt` for rows already submitted. That is the closest
 * honest approximation available: entries are created and submitted in the
 * same sitting in the common case, and no better record exists. Rows still in
 * draft stay null, because they have not been submitted.
 */
export class AddOtjSubmittedAt1781100000021 implements MigrationInterface {
  name = 'AddOtjSubmittedAt1781100000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "submittedAt" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `UPDATE "otj_log_entries" SET "submittedAt" = "createdAt" WHERE "status" <> 'draft'`,
    );

    // The approvals queue reads submitted entries ordered by how long they
    // have waited; without this it is a scan of the whole org's history.
    await queryRunner.query(
      `CREATE INDEX "IDX_otj_log_entries_org_submitted_at" ON "otj_log_entries" ("organisationId", "submittedAt") WHERE "submittedAt" IS NOT NULL AND "isDeleted" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_otj_log_entries_org_submitted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "submittedAt"`,
    );
  }
}
