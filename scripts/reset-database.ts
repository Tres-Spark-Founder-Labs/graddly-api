/**
 * Empty every data table, keeping the schema and migration history.
 *
 * For walking the product as a real user would: sign up, create an
 * organisation, invite people, enrol a learner — with nothing pre-existing to
 * lean on. Seeded data hides exactly the defects that kind of test finds,
 * because every screen already has something to render.
 *
 * ── WHY TRUNCATE AND NOT DROP ───────────────────────────────────────────────
 *
 * Dropping the database would take the schema and the `migrations` table with
 * it, so the next boot would replay 50 migrations — slow, and it would mask
 * whether the current schema is actually correct. This keeps the schema exactly
 * as deployed and removes only rows.
 *
 * `migrations` is excluded for the same reason: emptying it would make TypeORM
 * re-run every migration against a schema that already has the objects, which
 * fails on the first `CREATE TABLE`.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * Local hosts only, and the database name must be a known dev name. There is no
 * remote escape hatch: unlike the additive flow seed, this is purely
 * destructive, and no flag should make it easy to point at something shared.
 *
 *   npx nest build
 *   SEED_ALLOW=yes node dist/scripts/reset-database.js
 */
import 'dotenv/config';

import AppDataSource from '../src/config/data-source.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);
const DEV_DB_NAMES = new Set(['graddly', 'graddly_test', 'graddly_dev']);

/** Never emptied — see the note above. */
const PRESERVED = new Set(['migrations', 'typeorm_metadata']);

function resolveHost(): string {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '(unparseable DATABASE_URL)';
    }
  }
  return process.env.DB_HOST ?? 'localhost';
}

async function main() {
  const host = resolveHost();
  const dbName = process.env.DB_NAME ?? '';

  if (process.env.SEED_ALLOW !== 'yes') {
    throw new Error('Refusing to run without SEED_ALLOW=yes');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to wipe a non-local database (host "${host}"). This script has ` +
        `no remote override on purpose.`,
    );
  }
  if (!DEV_DB_NAMES.has(dbName)) {
    throw new Error(
      `Refusing to wipe database "${dbName}" — not a known dev name ` +
        `(${[...DEV_DB_NAMES].join(', ')}).`,
    );
  }

  const ds = await AppDataSource.initialize();
  console.log(`connected to ${dbName} on ${host}`);

  const rows = await ds.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows
    .map((r) => r.tablename)
    .filter((t) => !PRESERVED.has(t));

  if (tables.length === 0) {
    console.log('no tables to clear');
    await ds.destroy();
    return;
  }

  /**
   * One TRUNCATE for all of them. Doing it table by table would fail on
   * foreign keys unless the order were exactly right; a single statement with
   * CASCADE lets Postgres work that out. `RESTART IDENTITY` resets sequences so
   * a fresh run starts from the same place every time.
   *
   * Row-level security does not apply to TRUNCATE, but the app role may not own
   * every table — so this reports clearly rather than failing halfway.
   */
  const list = tables.map((t) => `"${t}"`).join(', ');
  try {
    await ds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } catch (err) {
    console.error(
      `\nTRUNCATE failed. This usually means the connecting role does not own ` +
        `every table — try running with the migration role:\n` +
        `  DB_USERNAME=$DB_MIGRATION_USERNAME DB_PASSWORD=$DB_MIGRATION_PASSWORD ...\n`,
    );
    throw err;
  }

  console.log(`cleared ${tables.length} tables`);
  console.log('\nThe database is empty. Sign up at a portal to begin.');
  await ds.destroy();
}

main().catch((err) => {
  console.error('RESET FAILED:', err);
  process.exit(1);
});
