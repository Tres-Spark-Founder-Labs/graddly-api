/* eslint-disable no-console */
/**
 * Fails the deploy when the application role cannot reach something it needs.
 *
 * `provision-app-role.ts` already sets default privileges for tables and
 * sequences, so in a correctly configured deployment this finds nothing. It
 * exists because the ways that configuration goes wrong are all silent until
 * a user hits the affected object:
 *
 *  1. `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>` only covers objects
 *     created by that specific role. `DB_MIGRATION_USERNAME` defaults to
 *     `postgres`; if migrations actually run as someone else, the default
 *     privileges attach to the wrong role and quietly cover nothing. New
 *     tables then fail at runtime with `permission denied`, long after the
 *     migration that created them reported success.
 *
 *  2. The application may be connecting as the wrong role entirely. A
 *     superuser passes every privilege check trivially *and* ignores
 *     row-level security, so all tenant isolation is off with no error
 *     anywhere. That is not hypothetical — it is how the development
 *     database is configured, which is why the F1.2.2 RLS verification had to
 *     connect as a different role to mean anything.
 *
 * Enum types are checked for completeness rather than because they are at
 * risk: Postgres has no `ALTER DEFAULT PRIVILEGES ... ON TYPES`, but the
 * default for a type is USAGE to PUBLIC, so enums are reachable unless
 * somebody explicitly revokes that. The loop in `provision-app-role.ts` is
 * belt-and-braces. Verified against `digest_frequency` and
 * `otj_pace_alert_level`, both of which have a NULL `typacl`.
 *
 * Run straight after `migration:run` so a misconfiguration fails the deploy
 * instead of surfacing in production.
 */
import 'dotenv/config';

import { Client } from 'pg';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

interface IMissingGrant {
  kind: 'table' | 'sequence' | 'enum';
  name: string;
  detail: string;
}

async function main(): Promise<void> {
  const appRole = requireEnv('DB_USERNAME');

  const client = new Client({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    // Falls back to the app credentials rather than a hardcoded `postgres`,
    // which fails with 28P01 on any setup that does not happen to have a
    // `postgres` role with the same password.
    user: process.env.DB_MIGRATION_USERNAME?.trim() || requireEnv('DB_USERNAME'),
    password: process.env.DB_MIGRATION_PASSWORD ?? requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  });

  await client.connect();

  try {
    const missing: IMissingGrant[] = [];

    /**
     * Before checking grants, check that grants are even the mechanism in
     * play. A superuser — or any role with BYPASSRLS — passes every privilege
     * check trivially *and* ignores row-level security, so an environment
     * configured this way silently exercises none of the tenant isolation the
     * policies exist to provide.
     *
     * This is not hypothetical: it is how the development database is set up,
     * which is why the F1.2.2 RLS verification had to connect as a different
     * role to mean anything.
     */
    const roleInfo = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [
      appRole,
    ]);

    if (roleInfo.rowCount === 0) {
      console.error(`✗ Role "${appRole}" does not exist in this database.`);
      process.exitCode = 1;
      return;
    }

    const { rolsuper, rolbypassrls } = roleInfo.rows[0];
    if (rolsuper || rolbypassrls) {
      console.warn(
        `⚠ Role "${appRole}" has ${rolsuper ? 'SUPERUSER' : 'BYPASSRLS'}.\n` +
          `  Every privilege check below passes trivially, and row-level security\n` +
          `  is not enforced for this connection — tenant isolation is effectively\n` +
          `  off. Fine for a local sandbox; a serious problem anywhere else.\n` +
          `  The application should connect as the NOSUPERUSER NOBYPASSRLS role\n` +
          `  created by "yarn db:provision-role".\n`,
      );
    }

    /**
     * `has_*_privilege` answers the real question — "could this role do it" —
     * rather than parsing ACL strings, so role inheritance and PUBLIC grants
     * are accounted for.
     *
     * Each query filters by `relkind`/`typtype` in an inner subquery with
     * `OFFSET 0`. That is an optimisation fence: without it Postgres is free
     * to flatten the subquery and evaluate the privilege function against
     * rows the filter was meant to exclude, which fails with 42809
     * ("is not a sequence") rather than returning a wrong answer.
     */
    const tables = await client.query<{ table_name: string; missing: string }>(
      `
      SELECT t.table_name,
             ARRAY_TO_STRING(ARRAY_REMOVE(ARRAY[
               CASE WHEN NOT has_table_privilege($1, t.oid, 'SELECT') THEN 'SELECT' END,
               CASE WHEN NOT has_table_privilege($1, t.oid, 'INSERT') THEN 'INSERT' END,
               CASE WHEN NOT has_table_privilege($1, t.oid, 'UPDATE') THEN 'UPDATE' END,
               CASE WHEN NOT has_table_privilege($1, t.oid, 'DELETE') THEN 'DELETE' END
             ], NULL), ', ') AS missing
      FROM (
        SELECT c.oid, c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        OFFSET 0
      ) t
      ORDER BY t.table_name
      `,
      [appRole],
    );

    for (const row of tables.rows) {
      if (row.missing) {
        missing.push({
          kind: 'table',
          name: row.table_name,
          detail: `missing ${row.missing}`,
        });
      }
    }

    const sequences = await client.query<{ sequence_name: string }>(
      `
      SELECT s.sequence_name
      FROM (
        SELECT c.oid, c.relname AS sequence_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
        OFFSET 0
      ) s
      WHERE NOT has_sequence_privilege($1, s.oid, 'USAGE')
      ORDER BY s.sequence_name
      `,
      [appRole],
    );

    for (const row of sequences.rows) {
      missing.push({
        kind: 'sequence',
        name: row.sequence_name,
        detail: 'missing USAGE',
      });
    }

    // Checked for completeness. Types default to USAGE for PUBLIC, so these
    // are reachable unless somebody has explicitly revoked it.
    const enums = await client.query<{ type_name: string }>(
      `
      SELECT e.type_name
      FROM (
        SELECT t.oid, t.typname AS type_name
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
        OFFSET 0
      ) e
      WHERE NOT has_type_privilege($1, e.oid, 'USAGE')
      ORDER BY e.type_name
      `,
      [appRole],
    );

    for (const row of enums.rows) {
      missing.push({
        kind: 'enum',
        name: row.type_name,
        detail: 'missing USAGE',
      });
    }

    if (missing.length === 0) {
      console.log(
        `✓ Role "${appRole}" has the privileges it needs on ${tables.rowCount} table(s), ` +
          `${sequences.rowCount === 0 ? 'all' : ''} sequences and all enums in schema public.`,
      );
      return;
    }

    console.error(
      `✗ Role "${appRole}" is missing privileges on ${missing.length} object(s).\n` +
        `  These fail at runtime as "permission denied", not at migration time.\n` +
        `  Fix: run "yarn db:provision-role" (and check DB_MIGRATION_USERNAME matches\n` +
        `  the role that runs migrations, or default privileges attach to the wrong one).\n`,
    );
    for (const item of missing) {
      console.error(`  - ${item.kind} ${item.name}: ${item.detail}`);
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
