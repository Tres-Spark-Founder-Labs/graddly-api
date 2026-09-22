import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';

import {
  applyTenantGucs,
  isTenantGucQuery,
  setGucQueryRunner,
} from './apply-tenant-gucs.js';

let patched = false;

/**
 * The statements the tenant session-variable SELECT is NOT sent in front of.
 *
 * Every other statement gets `SELECT set_config('app.current_org', ...)` sent
 * ahead of it on the same connection (the patch below). These do not:
 *
 *   ROLLBACK, ROLLBACK TO SAVEPOINT, ABORT
 *   SET TRANSACTION ...
 *
 * ── ROLLBACK ────────────────────────────────────────────────────────────────
 *
 * Once a statement fails inside a transaction, Postgres refuses every
 * statement except ROLLBACK until the transaction is rolled back. The patch
 * used to send its session-variable SELECT ahead of TypeORM's ROLLBACK too;
 * that SELECT was refused, the ROLLBACK was never sent, and the connection
 * went back to the pool mid-transaction — so the next request to draw it, on
 * any tenant, failed with "current transaction is aborted"
 * (test/pooled-connection-after-failure.e2e-spec.ts).
 *
 * A ROLLBACK reads nothing, so it needs no session variables. Exempting it
 * removes the cause: the ROLLBACK is sent, the connection comes back clean
 * and goes on serving, and nothing is discarded or reconnected. ABORT is the
 * Postgres synonym; TypeORM never emits it, but a hand-written one would fail
 * the same way.
 *
 * ── SET TRANSACTION ─────────────────────────────────────────────────────────
 *
 * `SET TRANSACTION ISOLATION LEVEL` (TypeORM emits it for
 * `transaction('REPEATABLE READ', ...)` and `startTransaction(level)`) must
 * be the first statement of its transaction: Postgres refuses it once a
 * snapshot has been taken, and the session-variable SELECT takes one. With
 * the SELECT in front, every REPEATABLE READ or SERIALIZABLE transaction
 * failed at its first statement. Nothing in src/ asks for an isolation level
 * today, so this was latent, not live — and is written down here so it does
 * not survive the way the ROLLBACK one did.
 *
 * Exempting it loses nothing: SET TRANSACTION reads no rows, and the first
 * statement that does is preceded by the SELECT as usual, inside the
 * transaction, with the isolation level already in force.
 *
 * ── DELIBERATELY NOT EXEMPT ─────────────────────────────────────────────────
 *
 * COMMIT. Postgres answers a COMMIT on an aborted transaction with ROLLBACK
 * and no error, so code that swallowed a failed statement and carried on
 * would be told its write landed. The session-variable SELECT in front of
 * COMMIT is refused in that state, which turns the silent rollback into an
 * error the caller sees — and TypeORM's ROLLBACK, exempt, then cleans the
 * connection.
 *
 * SAVEPOINT and RELEASE SAVEPOINT: in an aborted transaction they are refused
 * either way, and in a healthy one the SELECT in front of them is harmless.
 * START TRANSACTION: the SELECT before it runs outside the transaction.
 *
 * ── THE ALTERNATIVE ─────────────────────────────────────────────────────────
 *
 * Detecting the aborted state on release and destroying the connection would
 * also keep an aborted connection out of service, but leaves the ROLLBACK
 * unsent (the server rolls back on disconnect), costs a reconnect and TLS
 * handshake per failure, and treats the symptom where this removes the cause.
 *
 * ── THE MATCH ───────────────────────────────────────────────────────────────
 *
 * A prefix match on the statement text: leading whitespace, any case, and
 * whatever follows the keyword (a savepoint name, quoted or not; a trailing
 * semicolon). The spec captures the statements from a real
 * PostgresQueryRunner rather than from strings we chose, so the match is
 * checked against what TypeORM emits, not against what we assume it emits.
 */
export function isGucExemptStatement(query: string): boolean {
  return /^\s*(?:ROLLBACK|ABORT|SET\s+TRANSACTION)\b/i.test(query);
}

type PostgresQueryMethod = (
  this: PostgresQueryRunner,
  query: string,
  parameters?: unknown[],
  useStructuredResult?: boolean,
) => Promise<unknown>;

/**
 * TypeORM 0.3.28 does not invoke EntitySubscriberInterface.beforeQuery.
 * Patch PostgresQueryRunner.query to set tenant GUCs before each SQL statement.
 */
export function patchPostgresQueryRunnerForTenantGucs(): void {
  if (patched) {
    return;
  }
  patched = true;

  const queryDescriptor = Object.getOwnPropertyDescriptor(
    PostgresQueryRunner.prototype,
    'query',
  );
  const queryImpl: unknown = queryDescriptor?.value;
  if (typeof queryImpl !== 'function') {
    throw new Error('PostgresQueryRunner.prototype.query is not a function');
  }
  const originalQuery = queryImpl as PostgresQueryMethod;

  setGucQueryRunner(originalQuery);

  PostgresQueryRunner.prototype.query = async function (
    this: PostgresQueryRunner,
    query: string,
    parameters?: unknown[],
    useStructuredResult?: boolean,
  ): Promise<unknown> {
    if (
      typeof query === 'string' &&
      !isTenantGucQuery(query) &&
      !isGucExemptStatement(query)
    ) {
      await applyTenantGucs(this);
    }
    return originalQuery.call(this, query, parameters, useStructuredResult);
  };
}

patchPostgresQueryRunnerForTenantGucs();
