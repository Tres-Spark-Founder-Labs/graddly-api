import { isRollbackStatement } from './postgres-query-runner.patch.js';

/**
 * The statements the tenant session-variable query is not sent in front of.
 * Exactly the ROLLBACK family: sent after a failure, they must reach
 * Postgres, and a ROLLBACK reads nothing. The behaviour itself — a failed
 * statement leaves the pooled connection clean — is proved against Postgres
 * in test/pooled-connection-after-failure.e2e-spec.ts.
 */
describe('isRollbackStatement', () => {
  it.each([
    'ROLLBACK',
    'ROLLBACK TO SAVEPOINT typeorm_1',
    '  rollback',
    'ABORT',
  ])('exempts %p', (sql) => {
    expect(isRollbackStatement(sql)).toBe(true);
  });

  it.each([
    // COMMIT keeps its session-variable query so a commit of an aborted
    // transaction fails loudly instead of rolling back in silence.
    'COMMIT',
    'START TRANSACTION',
    'SAVEPOINT typeorm_1',
    'RELEASE SAVEPOINT typeorm_1',
    'SELECT rollback_count FROM stats',
    'UPDATE t SET note = $1 -- ROLLBACK',
  ])('does not exempt %p', (sql) => {
    expect(isRollbackStatement(sql)).toBe(false);
  });
});
