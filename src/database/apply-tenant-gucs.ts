import { Logger } from '@nestjs/common';

import {
  getContextLabel,
  getCorrelationId,
  getCurrentOrganisationId,
  getCurrentUserId,
  getRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { getEnv } from '../config/validate-env.js';

import type { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';

export const TENANT_GUC_SQL = `SELECT set_config('app.current_org', $1::text, false),
              set_config('app.current_user', $2::text, false),
              set_config('app.rls_bootstrap', $3::text, false)`;

export function isTenantGucQuery(query: string): boolean {
  return query.includes("set_config('app.current_org'");
}

export type GucQueryFn = (
  this: PostgresQueryRunner,
  query: string,
  parameters?: unknown[],
) => Promise<unknown>;

let runGucQuery: GucQueryFn | null = null;

/** Wired from {@link patchPostgresQueryRunnerForTenantGucs} to avoid recursive query patching. */
export function setGucQueryRunner(runner: GucQueryFn): void {
  runGucQuery = runner;
}

const logger = new Logger('TenantGucs');

/**
 * Labels already warned about. A route that legitimately has no organisation
 * — the auth funnel, /organisations for a user with no membership — says so
 * once per process, not once per statement.
 */
const warnedMissing = new Set<string>();

function warnMissingOnce(kind: 'organisation' | 'user'): void {
  const correlationId = getCorrelationId();
  const label =
    getContextLabel() ??
    (correlationId ? `correlation ${correlationId}` : 'no tenant context');
  const key = `${kind}:${label}`;
  if (warnedMissing.has(key)) {
    return;
  }
  warnedMissing.add(key);
  logger.warn(
    `No ${kind} in the tenant context for ${label}: ` +
      `app.current_${kind === 'organisation' ? 'org' : 'user'} is sent empty, ` +
      'so policies keyed on it match nothing.',
  );
}

/**
 * The store, and nothing else.
 *
 * This used to fall through `??` to a process-global fallback and then to
 * `lastKnownOrganisationIdForGuc` / `lastKnownUserIdForGuc`, each written by
 * every request's guards and every job. A request whose store carried no
 * organisation — a token without one, a route behind JwtAuthGuard alone — or
 * a worker job, which had no store at all, therefore sent whichever tenant had
 * written last, and every row policy evaluated correctly against it.
 *
 * Now a missing value is sent as '', which `app_current_org()` never matches:
 * the request fails closed rather than borrowing, and the warning names the
 * route or job so the paths that genuinely need an organisation surface
 * without taking the service down. Throwing would have turned a silent data
 * fault into an outage on routes that were working by accident.
 */
function resolveTenantGucValues(): [string, string, string] {
  const orgId = getCurrentOrganisationId() ?? '';
  const userId = getCurrentUserId() ?? '';
  if (!orgId) {
    warnMissingOnce('organisation');
  }
  if (!userId) {
    warnMissingOnce('user');
  }
  return [orgId, userId, getRlsBootstrap() ? '1' : '0'];
}

/** Sets session GUCs used by Postgres RLS policies on the query runner connection. */
export async function applyTenantGucs(
  queryRunner: PostgresQueryRunner,
): Promise<void> {
  if (!getEnv().TENANT_DB_CONTEXT_ENABLED || !runGucQuery) {
    return;
  }

  const [orgId, userId, bootstrap] = resolveTenantGucValues();
  await runGucQuery.call(queryRunner, TENANT_GUC_SQL, [
    orgId,
    userId,
    bootstrap,
  ]);
}
