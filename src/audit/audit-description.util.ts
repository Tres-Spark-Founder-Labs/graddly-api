/* eslint-disable @typescript-eslint/naming-convention -- keys are Postgres table names, which is what lands in entityType */
import { AuditAction } from './enums/audit-action.enum.js';

/**
 * F1.3.3 AC2 — "each entry includes … action description".
 *
 * The `changes` diff records which columns moved. That answers "what changed
 * in the database", which is not the question an Ofsted inspector is asking.
 * They are asking what a person did. `{"status":{"from":"awaiting_signatures",
 * "to":"signed"}}` requires the reader to know the schema; "Commitment
 * statement fully signed" does not.
 *
 * Kept as a pure function of entity type and action so it can be unit tested
 * and so the wording lives in one place rather than being assembled at each
 * call site.
 */

/**
 * Human-readable entity names, in the language of the domain not the schema.
 *
 * Keyed by table name, because that is what lands in
 * `audit_log_entries.entityType` — see `audit-entity-types.ts`.
 */
const ENTITY_LABELS: Record<string, string> = {
  commitment_statements: 'commitment statement',
  commitment_signatures: 'commitment statement signature',
  commitment_statement_groups: 'commitment statement record',
  otj_log_entries: 'off-the-job log entry',
  organisations: 'organisation',
  organisation_memberships: 'organisation membership',
  invitations: 'invitation',
  reviews: 'review',
  review_records: 'review record',
  review_signatures: 'review signature',
  ks_evidence_items: 'portfolio evidence item',
};

export function entityLabel(entityType: string): string {
  return (
    ENTITY_LABELS[entityType] ??
    // Fall back to something readable rather than printing the raw value:
    // "review_records" reads better as "review records", and "ReviewRecord"
    // as "review record", for an entity nobody has added a label for yet.
    entityType
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim()
      .toLowerCase()
  );
}

const ACTION_VERBS: Record<AuditAction, string> = {
  [AuditAction.INSERT]: 'Created',
  [AuditAction.UPDATE]: 'Edited',
  [AuditAction.DELETE]: 'Deleted',
  [AuditAction.ERASE]: 'Erased personal data from',
  [AuditAction.VIEW]: 'Viewed',
  [AuditAction.SIGN]: 'Signed',
  [AuditAction.VERSION_CHANGE]: 'Created a new version of',
};

/**
 * "Viewed commitment statement", "Created a new version of commitment
 * statement", and so on.
 *
 * `detail` appends context the entity type cannot supply — which party
 * signed, which version superseded which.
 */
export function describeAuditEvent(
  entityType: string,
  action: AuditAction,
  detail?: string,
): string {
  const verb = ACTION_VERBS[action] ?? 'Changed';
  const base = `${verb} ${entityLabel(entityType)}`;
  const described = detail ? `${base} — ${detail}` : base;

  // The column is varchar(500); truncate rather than let a long detail string
  // fail the insert and take the audited write down with it.
  return described.length > 500 ? `${described.slice(0, 497)}...` : described;
}
