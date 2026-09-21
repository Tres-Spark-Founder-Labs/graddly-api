import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.3.4 AC5 — "Download link is also sent by email for convenience".
 *
 * `epa_pack_jobs.downloadEmailSentAt` is the sent marker for that email. It
 * is claimed with a conditional UPDATE (`WHERE status = 'completed' AND
 * "downloadEmailSentAt" IS NULL`) before the email is queued, so a job that
 * BullMQ re-delivers — a stalled worker, a retry after the pack was already
 * built — cannot email the same link twice. The queue's own once-only
 * semantics are not relied on: a job id is unique per enqueue, not per
 * delivery.
 *
 * No policy change: the column sits on a table whose four policies are
 * already org-scoped with the bootstrap arm.
 */
export class EpaPackDownloadEmail1781100000059 implements MigrationInterface {
  name = 'EpaPackDownloadEmail1781100000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "epa_pack_jobs" ADD COLUMN "downloadEmailSentAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "epa_pack_jobs" DROP COLUMN "downloadEmailSentAt"`,
    );
  }
}
