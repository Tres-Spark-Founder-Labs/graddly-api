import { DataSource } from 'typeorm';

import { runWithTenantContext } from '../src/common/context/correlation-id-context.js';

/**
 * A connection that has been through a failed statement never serves another
 * request while its transaction is aborted.
 *
 * ── THE FAULT ───────────────────────────────────────────────────────────────
 *
 * `postgres-query-runner.patch.ts` sends the tenant session variables before
 * every statement. When a statement inside a transaction fails, Postgres
 * marks the transaction aborted and refuses everything except ROLLBACK. The
 * patch then sent its session-variable SELECT ahead of TypeORM's ROLLBACK;
 * that SELECT was refused, the ROLLBACK was never sent, and the connection
 * went back to the pool mid-transaction. The next request to draw it — any
 * request, on any tenant — failed with "current transaction is aborted".
 *
 * ── HOW THIS PROVES IT ──────────────────────────────────────────────────────
 *
 * A data source with a pool of one, so the request after the failure is
 * certain to draw the connection the failure used. Connected as the app role
 * (`graddly_app`, RLS enforced), with the same patched query runner every
 * request uses (loaded by test/load-env.ts).
 */
describe('a failed statement does not poison the pooled connection (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [],
      extra: { max: 1 },
    });
    await ds.initialize();
    await ds.query(
      'CREATE TEMP TABLE IF NOT EXISTS pool_probe (id int PRIMARY KEY)',
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM pool_probe');
  });

  const role = async (): Promise<{ role: string; bypass: boolean }> => {
    const [row] = await ds.query(
      `SELECT current_user AS role, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    return row;
  };

  it('runs as the app role, with RLS enforced', async () => {
    expect(await role()).toEqual({ role: 'graddly_app', bypass: false });
  });

  it('serves the next request after a statement fails inside a transaction', async () => {
    await expect(
      ds.transaction(async (em) => {
        await em.query('INSERT INTO pool_probe (id) VALUES (1)');
        await em.query('SELECT 1 / 0');
      }),
    ).rejects.toThrow('division by zero');

    // A different request on the same (only) connection.
    await expect(ds.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
    // And the failed transaction's write did not land.
    expect(await ds.query('SELECT id FROM pool_probe')).toEqual([]);
  });

  it('serves the next request after a write is refused by row-level security', async () => {
    // As a cron with no organisation: the levy dispatch insert that was
    // refused in production shape before its bootstrap window was added.
    await expect(
      ds.transaction(async (em) => {
        await em.query(
          `INSERT INTO levy_expiry_alert_dispatches
             ("organisationId","donorLinkId","trancheId","alertType","sentAt")
           VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'days_90', now())`,
        );
      }),
    ).rejects.toThrow('row-level security');

    await expect(ds.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
  });

  it('fails a commit of an aborted transaction loudly, rather than rolling it back in silence', async () => {
    // Code that swallows a failed statement and carries on: Postgres answers
    // COMMIT on an aborted transaction with ROLLBACK and no error, so the
    // caller would be told its write landed. It must be told it did not.
    await expect(
      ds.transaction(async (em) => {
        await em.query('INSERT INTO pool_probe (id) VALUES (2)');
        await em.query('SELECT 1 / 0').catch(() => undefined);
      }),
    ).rejects.toThrow('current transaction is aborted');

    expect(await ds.query('SELECT id FROM pool_probe')).toEqual([]);
    await expect(ds.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
  });

  it('keeps a savepoint rollback working: the outer transaction commits, the inner write does not', async () => {
    await ds.transaction(async (outer) => {
      await outer.query('INSERT INTO pool_probe (id) VALUES (3)');
      await expect(
        outer.transaction(async (inner) => {
          await inner.query('INSERT INTO pool_probe (id) VALUES (4)');
          await inner.query('SELECT 1 / 0');
        }),
      ).rejects.toThrow('division by zero');
    });

    expect(
      (
        await ds.query<{ id: number }[]>(
          'SELECT id FROM pool_probe ORDER BY id',
        )
      ).map((r) => r.id),
    ).toEqual([3]);
  });

  /**
   * SET TRANSACTION ISOLATION LEVEL must be the first statement of its
   * transaction; the session-variable SELECT in front of it took a snapshot
   * first, so every REPEATABLE READ or SERIALIZABLE transaction failed at
   * its first statement. Nothing in src/ asks for one today (latent), and
   * the exemption must not cost the statements after it their tenant.
   */
  it('opens a REPEATABLE READ transaction, and the statements inside it still carry the tenant', async () => {
    const seen = await runWithTenantContext(
      { label: 'e2e:isolation', organisationId: 'org-isolation' },
      () =>
        ds.transaction('REPEATABLE READ', async (em) => {
          const [row] = await em.query(
            `SELECT current_setting('transaction_isolation') AS level,
                    current_setting('app.current_org', true) AS org`,
          );
          return row;
        }),
    );
    expect(seen).toEqual({ level: 'repeatable read', org: 'org-isolation' });

    await expect(ds.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
  });

  /**
   * Task 6.5 — a failing audit insert fails the write it was auditing, and
   * affects no other request. The audit row is written by
   * AuditLogSubscriber inside the entity's own transaction; here the entity
   * write and the refused audit insert are the same two statements.
   */
  it('fails the audited write when its audit insert fails, and leaves the connection clean', async () => {
    await expect(
      ds.transaction(async (em) => {
        await em.query('INSERT INTO pool_probe (id) VALUES (5)');
        // An audit row the table refuses (an action outside its enum).
        await em.query(
          `INSERT INTO audit_log_entries ("entityType","entityId",action,changes)
           VALUES ('pool_probe', gen_random_uuid(), 'not_an_action', '{}'::jsonb)`,
        );
      }),
    ).rejects.toThrow();

    expect(await ds.query('SELECT id FROM pool_probe')).toEqual([]);
    await expect(ds.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
  });
});
