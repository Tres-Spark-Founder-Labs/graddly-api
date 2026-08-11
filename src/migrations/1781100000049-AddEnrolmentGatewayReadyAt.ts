import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.2.2 AC5, client decision Q3 — record the moment an apprentice became
 * gateway ready, rather than recomputing readiness on every render.
 *
 * `gatewayReadyNotifiedAt` already existed but answers a different question:
 * it is a de-duplication marker for the provider notification. It cannot stand
 * in for the readiness moment, because it is only ever set when a notification
 * is actually dispatched — an apprentice who became ready while the provider
 * organisation had no active owner or admin would have readiness with no
 * timestamp at all.
 *
 * Backfilled from the notification marker, because that timestamp is the best
 * evidence we hold of when readiness was first observed on existing rows. It
 * is explicitly an approximation: it records when the provider was told, which
 * is the first *read* after readiness, not the moment the last criterion was
 * met. Enrolments whose readiness has since lapsed are corrected on their next
 * read, where the service clears both columns together.
 *
 * Column identifiers are camelCase and quoted, matching
 * `1781000000006-AddEnrolmentJourneyAndPace` and the rest of this table — this
 * project runs TypeORM with no snake_case naming strategy.
 */
export class AddEnrolmentGatewayReadyAt1781100000049 implements MigrationInterface {
  name = 'AddEnrolmentGatewayReadyAt1781100000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN IF NOT EXISTS "gatewayReadyAt" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `UPDATE "enrolments"
          SET "gatewayReadyAt" = "gatewayReadyNotifiedAt"
        WHERE "gatewayReadyNotifiedAt" IS NOT NULL
          AND "gatewayReadyAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN IF EXISTS "gatewayReadyAt"`,
    );
  }
}
