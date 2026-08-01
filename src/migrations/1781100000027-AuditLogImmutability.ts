import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.3 AC4 — "audit trail cannot be deleted or modified — immutable once
 * written".
 *
 * Nothing enforces this today. `audit_log_entries` carries an UPDATE policy —
 * added by `1780800000002` so that GDPR erasure could scrub rows — which
 * permits *any* write to an entry belonging to the caller's own organisation:
 *
 *     CREATE POLICY audit_log_entries_update ON audit_log_entries
 *       FOR UPDATE
 *       USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
 *
 * It scopes by tenant, not by column. Erasure needs to change two fields, and
 * the policy grants the whole row: an application-role connection can rewrite
 * an entry's action, backdate it, or point it at a different record, and the
 * database will accept it.
 *
 * DELETE has no policy, so that much is refused — but only by omission. A
 * later migration adding one would open it silently, and neither omission nor
 * policy binds the table owner or a superuser, whom RLS does not constrain at
 * all. The development environment connects as exactly such a superuser, so
 * locally there is no protection of any kind.
 *
 * A trigger is used because it binds regardless of role, and because it can
 * discriminate by column, which an RLS policy cannot.
 *
 * ---
 *
 * **AC4 conflicts with the right to erasure, and the conflict is real.**
 *
 * `ErasureService.scrubAuditRows` updates audit entries when a data subject
 * exercises their UK GDPR Article 17 rights: it removes their email from the
 * `changes` payload and nulls `actorUserId`. A blanket "no UPDATE" rule would
 * make the platform unable to honour an erasure request — trading a
 * regulatory breach for a specification bullet point.
 *
 * The reconciliation is to separate *what happened* from *who it happened to*:
 *
 *  - **Immutable**: `entityType`, `entityId`, `action`, `organisationId`,
 *    `createdAt`, `id`. These are the evidential content. If they cannot be
 *    altered, the record of what occurred cannot be rewritten, which is what
 *    an Ofsted trail needs to be worth anything.
 *  - **Pseudonymisable**: `changes` and `actorUserId`. Erasure may remove
 *    personal data from these, and only these.
 *
 * DELETE is refused outright: erasure scrubs rows, it does not remove them,
 * so nothing in the platform legitimately deletes an audit entry.
 *
 * This is worth putting to the client rather than leaving as an
 * implementation detail — "immutable" in the criterion and "erasable" in the
 * regulation cannot both be absolute, and this migration encodes a specific
 * reading of where the line falls.
 */
export class AuditLogImmutability1781100000027 implements MigrationInterface {
  name = 'AuditLogImmutability1781100000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION audit_log_entries_immutable()
RETURNS TRIGGER AS $audit_immutable$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % cannot be deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- UPDATE: permit only the columns erasure needs to pseudonymise.
  IF NEW.id            IS DISTINCT FROM OLD.id
  OR NEW."entityType"  IS DISTINCT FROM OLD."entityType"
  OR NEW."entityId"    IS DISTINCT FROM OLD."entityId"
  OR NEW.action        IS DISTINCT FROM OLD.action
  OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
  OR NEW."createdAt"   IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION
      'audit_log_entries is append-only: entry % records what happened and cannot be altered. Only changes and actorUserId may be updated, for GDPR erasure.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$audit_immutable$ LANGUAGE plpgsql`);

    await queryRunner.query(`
CREATE TRIGGER audit_log_entries_immutable_trigger
BEFORE UPDATE OR DELETE ON audit_log_entries
FOR EACH ROW EXECUTE FUNCTION audit_log_entries_immutable()`);

    /**
     * No REVOKE here on purpose. `provision-app-role.ts` grants
     * SELECT/INSERT/UPDATE/DELETE across every table and re-runs after
     * migrations, so a revoke placed here would be handed straight back on the
     * next deploy — protection that looks present and is not. The role name is
     * also a deployment concern the migration does not know.
     *
     * The trigger binds regardless of role or grant, including for superusers,
     * which is the stronger guarantee. If a permission-layer refusal is wanted
     * as well, the revoke belongs in the provisioning script alongside the
     * grants it would otherwise contradict.
     */
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS audit_log_entries_immutable_trigger ON audit_log_entries`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS audit_log_entries_immutable()`,
    );
  }
}
