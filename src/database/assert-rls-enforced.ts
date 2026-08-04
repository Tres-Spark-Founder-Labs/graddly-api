import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Security hardening pass, item 2 — does this connection actually get RLS?
 *
 * Postgres skips row-level security entirely for a role that is SUPERUSER or
 * has BYPASSRLS. For such a connection every tenant-isolation policy in this
 * database is inert: a broken policy and a correct one behave identically, and
 * no amount of local testing or code review can tell them apart.
 *
 * That was the state of local development for the whole project. `.env` set
 * `DB_USERNAME=graddly`, a role with both flags set, so every RLS gap this
 * codebase has found — F1.2.2, F1.4.2, the eight in the audit table, the five
 * in item 1 — was undetectable on a developer's machine by construction.
 *
 * `yarn db:verify-grants` has reported this since it was written. The problem
 * with a script is that it only tells you on the days you remember to run it.
 * This runs on every boot instead.
 *
 * Deliberately a WARNING, not a hard failure. Refusing to start would be the
 * stricter choice, and the wrong one here: migrations, `db:setup` and the
 * audit-immutability verifier all connect as a superuser on purpose, and an
 * operator recovering a broken environment at 2am should not be blocked by a
 * check about tenancy hygiene. Loud and ignorable beats fatal and worked
 * around.
 */
export interface IConnectionRoleStatus {
  role: string;
  isSuperuser: boolean;
  bypassesRls: boolean;
  /** True when Postgres will actually apply RLS policies to this connection. */
  rlsEnforced: boolean;
}

export async function inspectConnectionRole(
  dataSource: DataSource,
): Promise<IConnectionRoleStatus | null> {
  try {
    const rows = await dataSource.query<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >(
      `SELECT rolname, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      role: row.rolname,
      isSuperuser: row.rolsuper,
      bypassesRls: row.rolbypassrls,
      // Superusers bypass RLS regardless of the BYPASSRLS flag, so both have
      // to be false for policies to mean anything.
      rlsEnforced: !row.rolsuper && !row.rolbypassrls,
    };
  } catch {
    // Never let a diagnostic stop the application from starting.
    return null;
  }
}

export async function assertRlsEnforced(dataSource: DataSource): Promise<void> {
  const logger = new Logger('RlsCheck');
  const status = await inspectConnectionRole(dataSource);

  if (!status) {
    logger.warn(
      'Could not determine the connected database role; RLS enforcement unverified.',
    );
    return;
  }

  if (status.rlsEnforced) {
    logger.log(
      `Database role "${status.role}" is NOSUPERUSER NOBYPASSRLS — row-level security is enforced.`,
    );
    return;
  }

  const reason = status.isSuperuser ? 'SUPERUSER' : 'BYPASSRLS';

  /**
   * Written as a block rather than one line on purpose. The single-line
   * version of this warning is exactly the kind of thing that scrolls past in
   * a boot log full of Nest route registrations, and this is the message that
   * needs to survive that.
   */
  logger.error(
    [
      '',
      '  ############################################################',
      `  #  TENANT ISOLATION IS OFF for this connection.`,
      `  #`,
      `  #  Database role : ${status.role}`,
      `  #  Reason        : role has ${reason}`,
      '  #',
      '  #  Postgres does not apply row-level security to this role.',
      '  #  Every tenant policy in the database is inert, and one',
      '  #  organisation can read another’s data through any query.',
      '  #',
      '  #  This is expected for migrations and admin tooling.',
      '  #  It is NOT expected for the application.',
      '  #',
      '  #  Fix: set DB_USERNAME=graddly_app (and DB_PASSWORD to match)',
      '  #  and keep DB_MIGRATION_USERNAME for schema changes only.',
      '  ############################################################',
      '',
    ].join('\n'),
  );
}
