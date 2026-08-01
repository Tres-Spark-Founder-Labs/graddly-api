/* eslint-disable @typescript-eslint/naming-convention -- constant keys, UPPER_SNAKE_CASE by convention */
/**
 * Entity types as they are written to `audit_log_entries.entityType`.
 *
 * `AuditLogSubscriber` files every entry under `event.metadata.tableName` —
 * `commitment_statements`, not `CommitmentStatement`. Events recorded
 * explicitly through `AuditEventService` must use the same spelling, or the
 * trail for one document splits across two names: the views and signatures
 * land under one, the inserts and edits under the other, and any query for
 * either silently returns half the history. The `?entityType=` filter on
 * `GET /audit/export` already assumes table names (`invitations`).
 *
 * Named here rather than typed at each call site so the two paths cannot
 * drift again.
 */
export const AUDIT_ENTITY_TYPE = {
  COMMITMENT_STATEMENT: 'commitment_statements',
  COMMITMENT_SIGNATURE: 'commitment_signatures',
  COMMITMENT_STATEMENT_GROUP: 'commitment_statement_groups',
} as const;

export type AuditEntityType =
  (typeof AUDIT_ENTITY_TYPE)[keyof typeof AUDIT_ENTITY_TYPE];
