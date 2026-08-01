import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.3 AC2 — "each entry includes: user name, role, timestamp, and action
 * description".
 *
 * An entry carried `actorUserId`, `createdAt` and a `changes` diff. One of
 * the four required fields, then, and the one least use to a human reading
 * the trail: a UUID does not tell an inspector who did something, and a
 * column-level diff does not tell them what was done.
 *
 * **These are captured at write time, not resolved on read.** An audit trail
 * must say what someone's name and role *were when they acted*. Joining to
 * `users` at read time would restate history every time somebody changes
 * their name or loses a role — a trail that quietly rewrites itself is not
 * evidence. Denormalising is the point, not a shortcut.
 *
 * `actorRole` stores the role held in the acting organisation at that moment,
 * which is what makes "who was allowed to do this" answerable a year later.
 *
 * ---
 *
 * **This adds a new personal-data field, and erasure has to know about it.**
 *
 * `actorName` is personal data. `ErasureService.scrubAuditRows` already
 * removes emails from `changes` and nulls `actorUserId`; it must now null
 * `actorName` too, or an Article 17 request would leave the subject's name
 * sitting in the audit trail. The immutability trigger from
 * `1781100000027` is widened in the same commit to permit that column to be
 * cleared — deliberately, and only for that purpose.
 *
 * Adding a denormalised name is the kind of change that silently defeats an
 * existing erasure routine, because nothing fails: the request succeeds and
 * the data stays.
 */
export class AuditActorDetails1781100000029 implements MigrationInterface {
  name = 'AuditActorDetails1781100000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" ADD "actorName" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" ADD "actorRole" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" ADD "description" character varying(500)`,
    );

    // Widen the immutability trigger: actorName joins the pseudonymisable set.
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION audit_log_entries_immutable()
RETURNS TRIGGER AS $audit_immutable$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Only changes, actorUserId and actorName may be updated, and only so that
  -- a UK GDPR Article 17 erasure can pseudonymise the subject. Everything
  -- that records *what happened* is fixed once written.
  IF NEW.id               IS DISTINCT FROM OLD.id
  OR NEW."entityType"     IS DISTINCT FROM OLD."entityType"
  OR NEW."entityId"       IS DISTINCT FROM OLD."entityId"
  OR NEW.action           IS DISTINCT FROM OLD.action
  OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
  OR NEW."createdAt"      IS DISTINCT FROM OLD."createdAt"
  OR NEW."actorRole"      IS DISTINCT FROM OLD."actorRole"
  OR NEW.description      IS DISTINCT FROM OLD.description
  THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % records what happened and cannot be altered. Only changes, actorUserId and actorName may be updated, for GDPR erasure.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$audit_immutable$ LANGUAGE plpgsql`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION audit_log_entries_immutable()
RETURNS TRIGGER AS $audit_immutable$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.id               IS DISTINCT FROM OLD.id
  OR NEW."entityType"     IS DISTINCT FROM OLD."entityType"
  OR NEW."entityId"       IS DISTINCT FROM OLD."entityId"
  OR NEW.action           IS DISTINCT FROM OLD.action
  OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
  OR NEW."createdAt"      IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % cannot be altered', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$audit_immutable$ LANGUAGE plpgsql`);

    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" DROP COLUMN "description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" DROP COLUMN "actorRole"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log_entries" DROP COLUMN "actorName"`,
    );
  }
}
