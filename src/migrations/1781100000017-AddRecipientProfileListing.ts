import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.1.4 AC2 — lets levy-paying employers browse SME recipients.
 *
 * Recipient profiles are org-scoped by RLS, so a donor querying them sees only
 * their own row. Rather than weakening that isolation wholesale, this adds an
 * explicit opt-in: an SME sets `isListed`, and only then does its profile
 * become visible to other tenants.
 *
 * The mechanism is a second, additive SELECT policy. Postgres ORs permissive
 * policies together, so the existing org-scoped policy is untouched — a
 * profile is visible if it belongs to you (as before) OR it is listed. An SME
 * that never opts in is exactly as private as it is today.
 *
 * Defaults to false: existing profiles stay private until their owner chooses
 * otherwise. Opt-out by default would silently publish live SME data.
 */
export class AddRecipientProfileListing1781100000017 implements MigrationInterface {
  name = 'AddRecipientProfileListing1781100000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "levy_recipient_profiles" ADD "isListed" boolean NOT NULL DEFAULT false`,
    );

    // Supports the directory's filter combination without scanning unlisted rows.
    await queryRunner.query(
      `CREATE INDEX "IDX_levy_recipient_profiles_listed" ON "levy_recipient_profiles" ("isListed", "sector", "region", "programmeType") WHERE "isListed" = true AND "isDeleted" = false`,
    );

    await queryRunner.query(`
CREATE POLICY levy_recipient_profiles_select_listed ON levy_recipient_profiles
  FOR SELECT
  USING ("isListed" = true AND "isDeleted" = false)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS levy_recipient_profiles_select_listed ON levy_recipient_profiles`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_levy_recipient_profiles_listed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "levy_recipient_profiles" DROP COLUMN "isListed"`,
    );
  }
}
