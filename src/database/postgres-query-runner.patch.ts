import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';

import {
  applyTenantGucs,
  isTenantGucQuery,
  setGucQueryRunner,
} from './apply-tenant-gucs.js';

let patched = false;

/**
 * ROLLBACK, ROLLBACK TO SAVEPOINT (and ABORT, its synonym): the statements
 * that must reach Postgres when a transaction has failed.
 *
 * ── WHY THESE AND ONLY THESE ────────────────────────────────────────────────
 *
 * Once a statement fails inside a transaction, Postgres refuses every
 * statement except these until the transaction is rolled back. The patch
 * below used to send its session-variable SELECT ahead of TypeORM's ROLLBACK
 * too; that SELECT was refused, the ROLLBACK was never sent, and the
 * connection went back to the pool mid-transaction — so the next request to
 * draw it, on any tenant, failed with "current transaction is aborted"
 * (test/pooled-connection-after-failure.e2e-spec.ts).
 *
 * A ROLLBACK reads nothing, so it needs no session variables. Exempting it
 * removes the cause: the ROLLBACK is sent, the connection comes back clean
 * and goes on serving, and nothing is discarded or reconnected.
 *
 * COMMIT is deliberately NOT exempt. Postgres answers a COMMIT on an aborted
 * transaction with ROLLBACK and no error, so code that swallowed a failed
 * statement and carried on would be told its write landed. The
 * session-variable SELECT in front of COMMIT is refused in that state, which
 * turns the silent rollback into an error the caller sees — and TypeORM's
 * ROLLBACK, now exempt, then cleans the connection. SAVEPOINT and RELEASE are
 * left as they are: in an aborted transaction they are refused either way.
 *
 * The alternative — detect the aborted state on release and destroy the
 * connection — would also keep an aborted connection out of service, but
 * leaves the ROLLBACK unsent (the server rolls back on disconnect), costs a
 * reconnect and TLS handshake per failure, and treats the symptom where
 * this removes the cause.
 */
export function isRollbackStatement(query: string): boolean {
  return /^\s*(ROLLBACK|ABORT)\b/i.test(query);
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
      !isRollbackStatement(query)
    ) {
      await applyTenantGucs(this);
    }
    return originalQuery.call(this, query, parameters, useStructuredResult);
  };
}

patchPostgresQueryRunnerForTenantGucs();
