import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.4 AC5 — the at-risk badge needs to say how far behind.
 *
 * `computeOtjPaceSnapshot` already calculates `behindPercent` on every cron
 * run. It was used once, transiently, to word a notification, and then thrown
 * away — so the only thing persisted was the band (`at_risk` / `off_track`),
 * and every screen could say "at risk" but none could say how bad.
 *
 * A manager triaging a roster needs the difference between 16% behind and 45%
 * behind: the first is a conversation, the second is a funding risk. Storing
 * the number alongside the level it produced also makes the flag auditable —
 * you can see why an enrolment was flagged, not just that it was.
 *
 * `numeric(6,2)` rather than a float: this is displayed to users and compared
 * against fixed thresholds, so exact decimal behaviour matters more than
 * range. Nullable because pace is not computable for every enrolment (no
 * planned duration, or no end date), and null there means "unknown", which is
 * genuinely different from zero.
 */
export class AddEnrolmentOtjBehindPercent1781100000022 implements MigrationInterface {
  name = 'AddEnrolmentOtjBehindPercent1781100000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD "otjBehindPercent" numeric(6,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "otjBehindPercent"`,
    );
  }
}
