import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F3.4.3 — one audited path for writing a notification to somebody else.
 *
 * ── WHY A FUNCTION AND NOT A POLICY ─────────────────────────────────────────
 *
 * Migration 1781100000051 re-keyed `notifications_insert` on the organisation
 * and the write *still* failed 42501. The reason was not the INSERT policy at
 * all. TypeORM's `save()` emits:
 *
 *     INSERT INTO "notifications" (...) VALUES (...)
 *       RETURNING "id","createdAt","updatedAt","isDeleted","deletedAt"
 *
 * `RETURNING` reads the row back, so the **SELECT** policy applies to it — and
 * `notifications_select` is `"userId" = app_current_user()`. The actor is by
 * definition not the recipient, so the read half was refused after the write
 * half had been allowed. That is why a hand-written INSERT without `RETURNING`
 * succeeded with identical values while `save()` did not: the two statements
 * are subject to different policies.
 *
 * No insert policy can fix that, because the obstacle is on the read side, and
 * widening `notifications_select` would turn every colleague's tray into a
 * readable inbox. A `SECURITY DEFINER` function runs as its owner, so neither
 * policy applies inside it — the write and the `RETURNING` both proceed, while
 * the table's policies stay exactly as tight as they are for everyone else.
 *
 * ── WHY THE GUARD CHECKS THE RECIPIENT, NOT THE ACTOR ───────────────────────
 *
 * `SECURITY DEFINER` bypasses RLS, so the function must impose its own rule or
 * it is simply a bypass with extra steps. The rule is: **the recipient must
 * hold an active membership in the organisation the notification is filed
 * under.** That is the invariant that makes the row meaningful — `listForUser`
 * filters by the reader's active organisation, so a notification filed under an
 * organisation the recipient does not belong to is invisible to them forever.
 *
 * It deliberately does *not* require the **actor** to be a member. Three sites
 * notify across an organisational boundary on purpose:
 *
 *   enrolment-journey.service.ts:546      employer action -> provider admins
 *   enrolment-provisioning.service.ts:159 employer action -> provider members
 *   otj-pace.service.ts:379               provider sweep  -> employer manager
 *
 * Requiring actor membership would break all three, and they are correct
 * behaviour, not accidents.
 *
 * ── SEARCH PATH ─────────────────────────────────────────────────────────────
 *
 * `SET search_path = pg_catalog, public` is mandatory on a `SECURITY DEFINER`
 * function. Without it a caller can prepend a schema of their own and shadow
 * any unqualified name the body resolves, executing their code with the
 * owner's privileges.
 *
 * ── THE INSERT POLICY GOES BACK ─────────────────────────────────────────────
 *
 * `notifications_insert` returns to `"userId" = app_current_user()`. Once every
 * write goes through this function, a *direct* third-party insert should stay
 * denied — that is what keeps the function the single audited path rather than
 * one option among two. `organisationId NOT NULL` from migration 51 is kept:
 * that part was right, and the function depends on it.
 */
export class CreateNotificationFunction1781100000052 implements MigrationInterface {
  name = 'CreateNotificationFunction1781100000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION app_create_notification(
  p_user_id  uuid,
  p_org_id   uuid,
  p_type     text,
  p_title    text,
  p_body     text,
  p_metadata jsonb
)
RETURNS notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row notifications;
BEGIN
  IF p_user_id IS NULL OR p_org_id IS NULL THEN
    RAISE EXCEPTION 'app_create_notification: recipient and organisation are both required'
      USING ERRCODE = '22004';
  END IF;

  -- The recipient must be able to see it. listForUser filters by the reader's
  -- active organisation, so a notification filed under an organisation the
  -- recipient does not belong to could never be read by anyone.
  IF NOT EXISTS (
    SELECT 1
    FROM organisation_memberships m
    WHERE m."userId" = p_user_id
      AND m."organisationId" = p_org_id
      AND m."isDeleted" = false
  ) THEN
    RAISE EXCEPTION
      'app_create_notification: recipient % is not an active member of organisation %',
      p_user_id, p_org_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO notifications ("userId", "organisationId", "type", "title", "body", "metadata")
  VALUES (p_user_id, p_org_id, p_type::notification_type, p_title, p_body, p_metadata)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$`);

    /**
     * Not callable by anybody who merely reaches the database. The application
     * role is granted explicitly; PUBLIC is revoked because a SECURITY DEFINER
     * function is executed with its owner's rights and should never be
     * available by default.
     */
    await queryRunner.query(
      `REVOKE ALL ON FUNCTION app_create_notification(uuid, uuid, text, text, text, jsonb) FROM PUBLIC`,
    );

    /**
     * Granted to the role the application actually connects as. Resolved from
     * the session rather than hard-coded: this repository uses `graddly_app`
     * locally and CI may differ, and a wrong literal here would fail closed at
     * runtime rather than at migration time.
     */
    await queryRunner.query(`
DO $$
DECLARE
  v_role text := current_setting('app.grant_role', true);
BEGIN
  IF v_role IS NULL OR v_role = '' THEN
    v_role := 'graddly_app';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION app_create_notification(uuid, uuid, text, text, text, jsonb) TO %I',
      v_role
    );
  END IF;
END
$$`);

    // Back to the original. The function is now the only way to write to
    // somebody else, which is the point.
    await queryRunner.query(
      `DROP POLICY IF EXISTS notifications_insert ON notifications`,
    );
    await queryRunner.query(`
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (
    app_rls_bootstrap()
    OR "userId" = app_current_user()
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS app_create_notification(uuid, uuid, text, text, text, jsonb)`,
    );

    /**
     * Leaves `notifications_insert` in the user-keyed form this migration
     * restored, which is also what migration 51's `down()` expects. Reverting
     * further is 51's job, not this one's.
     */
  }
}
