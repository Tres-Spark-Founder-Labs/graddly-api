import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.4.3 AC3 — per-type email preferences. Two changes the upsert needs.
 *
 * ── A PREFERENCE IS PER USER ────────────────────────────────────────────────
 *
 * `notification_preferences` carries a nullable `organisationId`, so a row
 * could in principle mean "this user, in this organisation". Every existing
 * read and write — the digest endpoints, `ensureDefaults`, the message email
 * check — uses `organisationId IS NULL`, and the preferences routes sit
 * behind JwtAuthGuard alone, with no organisation in context. That is the
 * model this keeps, deliberately: an email preference governs a person's
 * inbox. A tutor at one provider who is also a line manager at an employer
 * and switches off off-the-job emails means off-the-job emails. Keyed per
 * organisation, the switch would be silently partial — off for whichever
 * organisation's settings page they happened to use, still arriving from the
 * other — and no settings page, rendered under one active organisation, could
 * show that. The column stays, unused, for a per-organisation override if one
 * is ever wanted.
 *
 * ── WHY THE EXISTING UNIQUE INDEX DID NOT PROTECT THOSE ROWS ────────────────
 *
 * `UQ_notification_preferences_active` is on ("userId", "organisationId",
 * "channel", "type"). Postgres treats NULLs as distinct in a unique index, so
 * for the per-user rows — organisationId NULL, which is all of them — it
 * enforced nothing: `ensureDefaults` (read, then insert if absent) could
 * write the same preference twice under concurrency, and a later read would
 * pick one at random. A partial unique index over exactly the per-user rows
 * closes that, and gives the upsert a real conflict target.
 *
 * Any duplicates already present are soft-deleted first, keeping the most
 * recently updated row of each (userId, channel, type). None existed in the
 * development database when this was written; the step is for environments
 * nobody here can see.
 *
 * ── THE TWO F3.4.3 AC2 TYPES ────────────────────────────────────────────────
 *
 * `epa_date_updated` and `milestone_completed` join the `notification_type`
 * enum, which both `notifications` and `notification_preferences` use.
 * `ADD VALUE` cannot be undone in Postgres short of rebuilding the type, so
 * `down` leaves them in place.
 */
export class NotificationPreferencesPerUser1781100000057 implements MigrationInterface {
  name = 'NotificationPreferencesPerUser1781100000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE notification_preferences p
   SET "isDeleted" = true, "deletedAt" = now()
 WHERE p."isDeleted" = false
   AND p."organisationId" IS NULL
   AND p.id NOT IN (
     SELECT DISTINCT ON ("userId", channel, type) id
       FROM notification_preferences
      WHERE "isDeleted" = false AND "organisationId" IS NULL
      ORDER BY "userId", channel, type, "updatedAt" DESC, "createdAt" DESC
   )`);

    await queryRunner.query(`
CREATE UNIQUE INDEX "UQ_notification_preferences_user_default"
  ON notification_preferences ("userId", channel, type)
  WHERE "organisationId" IS NULL AND "isDeleted" = false`);

    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'epa_date_updated'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'milestone_completed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_notification_preferences_user_default"`,
    );
    // The enum values stay: Postgres cannot drop a value from an enum type.
  }
}
