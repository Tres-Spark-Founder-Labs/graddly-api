import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.3 AC7 — managers configure digest frequency: daily / weekly / off.
 *
 * `notification_preferences` could only express on/off per (user, channel,
 * type), so "daily" had nowhere to live and the digest cron fired weekly for
 * everyone regardless of preference.
 *
 * The column sits on the existing preference row rather than in a new table:
 * frequency is an attribute of an existing per-user channel preference, and a
 * separate table would need the same (user, channel, type) key for no gain.
 *
 * Defaults to 'weekly' so existing managers keep the behaviour they have
 * today — a migration that silently switched everyone to daily would be a
 * surprise delivered by email.
 *
 * Meaningful only where channel = 'digest'; other channels carry the default
 * and ignore it. That is why the column is NOT NULL with a default rather than
 * nullable-and-meaningful — a null would be a third state to interpret at
 * every read site.
 */
export class AddDigestFrequency1781100000020 implements MigrationInterface {
  name = 'AddDigestFrequency1781100000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly', 'off')`,
    );

    await queryRunner.query(
      `ALTER TABLE "notification_preferences" ADD "frequency" "public"."digest_frequency" NOT NULL DEFAULT 'weekly'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" DROP COLUMN "frequency"`,
    );
    await queryRunner.query(`DROP TYPE "public"."digest_frequency"`);
  }
}
