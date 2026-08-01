/* eslint-disable no-console */
/**
 * F1.3.3 AC4 — "audit trail cannot be deleted or modified — immutable once
 * written".
 *
 * Proves the guarantee by attempting to break it, rather than by reading the
 * migration and believing it. Every check runs inside a transaction that is
 * rolled back, so this is safe against any database including production.
 *
 * **Why a script and not an e2e test.** The claim is about what the *database*
 * refuses, for *every* role — including the superuser the development
 * environment connects as, whom row-level security does not constrain. An e2e
 * test exercises the API, which can only ever demonstrate that the
 * application does not try. That is a much weaker statement, and it is the
 * statement AC4 is explicitly not making.
 *
 * The connection deliberately uses the migration credentials, which in this
 * codebase are the superuser. Passing as a superuser is the point: if the
 * trigger holds for a role that bypasses RLS, it holds for everyone.
 *
 * Run after `yarn migration:run`.
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

/** Postgres raises `restrict_violation` (23001) from the trigger. */
const EXPECTED_ERRCODE = '23001';

interface ICheckContext {
  /** The seeded audit row. */
  id: string;
  /** A different, *existing* organisation — see MUST_BE_REFUSED below. */
  otherOrgId: string | null;
}

interface ICheck {
  name: string;
  /** SQL run against a seeded row; must be refused. */
  sql: (ctx: ICheckContext) => string;
  /** Skipped when the fixture it needs is unavailable. */
  requires?: (ctx: ICheckContext) => boolean;
}

/**
 * The evidential columns. Each one is attacked separately so a failure names
 * the specific field that is no longer protected, rather than "something".
 */
const MUST_BE_REFUSED: ICheck[] = [
  {
    name: 'DELETE the entry',
    sql: ({ id }) => `DELETE FROM audit_log_entries WHERE id = '${id}'`,
  },
  {
    name: 'rewrite entityType',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "entityType" = 'invitations' WHERE id = '${id}'`,
  },
  {
    name: 'rewrite entityId',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "entityId" = gen_random_uuid() WHERE id = '${id}'`,
  },
  {
    name: 'rewrite action',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET action = 'insert' WHERE id = '${id}'`,
  },
  {
    /**
     * Targets a real organisation on purpose. `organisationId` is a foreign
     * key, so a random UUID would be refused with 23503 by the constraint and
     * the check would report success without the trigger having run at all.
     */
    name: 'move the entry to another organisation',
    sql: ({ id, otherOrgId }) =>
      `UPDATE audit_log_entries SET "organisationId" = '${otherOrgId}' WHERE id = '${id}'`,
    requires: ({ otherOrgId }) => !!otherOrgId,
  },
  {
    // The FK is ON DELETE SET NULL, so this is also the path Postgres takes
    // when an organisation is hard-deleted.
    name: 'orphan the entry by nulling organisationId',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "organisationId" = NULL WHERE id = '${id}'`,
  },
  {
    name: 'backdate createdAt',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "createdAt" = now() - interval '1 year' WHERE id = '${id}'`,
  },
  {
    name: 'rewrite actorRole',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "actorRole" = 'owner' WHERE id = '${id}'`,
  },
  {
    name: 'rewrite the action description',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET description = 'Something else entirely' WHERE id = '${id}'`,
  },
  {
    name: 'change the primary key',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET id = gen_random_uuid() WHERE id = '${id}'`,
  },
];

/**
 * The pseudonymisable set. These must *succeed*: `ErasureService` writes
 * exactly these three columns, and a trigger that blocked them would make the
 * platform unable to honour a UK GDPR Article 17 request. Verifying the
 * permitted case matters as much as the refused one — a rule that forbids
 * everything satisfies AC4 and breaks the law.
 */
const MUST_BE_PERMITTED: ICheck[] = [
  {
    name: 'scrub personal data out of changes (Article 17)',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET changes = '{"email":{"to":"[erased]"}}'::jsonb WHERE id = '${id}'`,
  },
  {
    name: 'null actorUserId (Article 17)',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "actorUserId" = NULL WHERE id = '${id}'`,
  },
  {
    name: 'null actorName (Article 17)',
    sql: ({ id }) =>
      `UPDATE audit_log_entries SET "actorName" = NULL WHERE id = '${id}'`,
  },
];

async function main(): Promise<void> {
  const client = new Client({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user:
      process.env.DB_MIGRATION_USERNAME?.trim() || requireEnv('DB_USERNAME'),
    password: process.env.DB_MIGRATION_PASSWORD ?? requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  });

  await client.connect();
  const failures: string[] = [];

  try {
    const role = await client.query<{
      roleName: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user AS "roleName", rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );
    const { rolsuper, rolbypassrls } = role.rows[0];
    console.log(
      `Connected as "${role.rows[0].roleName}"` +
        (rolsuper || rolbypassrls
          ? ` (${rolsuper ? 'SUPERUSER' : 'BYPASSRLS'} — the strongest case: RLS does not constrain this role, so anything that refuses it refuses everyone).`
          : ' (not a superuser — the trigger is still the mechanism, but RLS would also be in play).'),
    );

    const trigger = await client.query(
      `SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'audit_log_entries'::regclass
          AND tgname = 'audit_log_entries_immutable_trigger'
          AND NOT tgisinternal`,
    );
    if (trigger.rowCount === 0) {
      console.error(
        '✗ Trigger audit_log_entries_immutable_trigger is not installed.\n' +
          '  Run "yarn migration:run" — migration 1781100000027 creates it.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      '✓ Trigger audit_log_entries_immutable_trigger is installed.\n',
    );

    /**
     * Everything below runs in one transaction that is always rolled back,
     * including the seed row. Nothing this script does survives it.
     */
    await client.query('BEGIN');

    /**
     * `actorUserId` and `organisationId` are real foreign keys, so the seed
     * row has to reference rows that exist — a random UUID fails with 23503
     * before the trigger is ever reached, which would make every check below
     * meaningless.
     *
     * Two organisations are needed, not one: "move the entry to another
     * organisation" has to target a *valid* organisation, or it would be
     * refused by the foreign key rather than by the trigger and the check
     * would pass for the wrong reason.
     */
    const fixtures = await client.query<{
      userId: string | null;
      orgId: string | null;
    }>(
      `SELECT (SELECT id FROM users LIMIT 1)         AS "userId",
              (SELECT id FROM organisations LIMIT 1) AS "orgId"`,
    );
    const { userId, orgId } = fixtures.rows[0];

    if (!userId || !orgId) {
      console.error(
        '✗ No users or organisations in this database.\n' +
          '  The audit table has foreign keys to both, so a seed row cannot be\n' +
          '  created and nothing below would be testing the trigger. Seed the\n' +
          '  database first, then re-run.',
      );
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }

    /**
     * A second organisation is created rather than looked up, so the
     * "move the entry to another organisation" check runs on every database
     * including a freshly seeded one with a single tenant. It exists only
     * inside this transaction, which is always rolled back.
     */
    const decoyOrg = await client.query<{ id: string }>(
      `INSERT INTO organisations (name, slug)
       VALUES ('AC4 verification (rolled back)',
               'ac4-verification-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const otherOrgId = decoyOrg.rows[0].id;

    const seeded = await client.query<{ id: string }>(
      `INSERT INTO audit_log_entries
         ("actorUserId", "actorName", "actorRole", description,
          "organisationId", "entityType", "entityId", action, changes)
       VALUES ($1, 'Verification Actor', 'admin',
               'Signed commitment statement', $2,
               'commitment_statements', gen_random_uuid(), 'sign', '{}'::jsonb)
       RETURNING id`,
      [userId, orgId],
    );
    const id = seeded.rows[0].id;
    const ctx: ICheckContext = { id, otherOrgId };

    for (const check of MUST_BE_REFUSED) {
      if (check.requires && !check.requires(ctx)) {
        console.log(`- ${check.name}: skipped (fixture unavailable)`);
        continue;
      }
      await client.query('SAVEPOINT attempt');
      try {
        await client.query(check.sql(ctx));
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        failures.push(`${check.name} — SUCCEEDED, but must be refused`);
        console.error(`✗ ${check.name}: allowed`);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        const code = (error as { code?: string }).code;
        if (code === EXPECTED_ERRCODE) {
          console.log(`✓ ${check.name}: refused`);
        } else {
          // Refused, but by something other than the trigger — a NOT NULL or
          // FK constraint would also block it, and would not mean AC4 holds.
          failures.push(
            `${check.name} — refused with SQLSTATE ${code ?? 'unknown'}, expected ${EXPECTED_ERRCODE} from the trigger`,
          );
          console.error(`✗ ${check.name}: refused by ${code ?? 'unknown'}`);
        }
      }
    }

    console.log('');

    for (const check of MUST_BE_PERMITTED) {
      await client.query('SAVEPOINT attempt');
      try {
        await client.query(check.sql(ctx));
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        console.log(`✓ ${check.name}: permitted`);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        const code = (error as { code?: string }).code;
        failures.push(
          `${check.name} — REFUSED (${code ?? 'unknown'}), but erasure needs it`,
        );
        console.error(`✗ ${check.name}: refused`);
      }
    }

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }

  console.log('');
  if (failures.length === 0) {
    console.log(
      '✓ F1.3.3 AC4 holds: the evidential record cannot be altered or deleted,\n' +
        '  and erasure can still pseudonymise the data subject.',
    );
    return;
  }

  console.error(`✗ ${failures.length} immutability check(s) failed:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
