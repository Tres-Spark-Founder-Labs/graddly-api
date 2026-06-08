import {
  getCurrentOrganisationId,
  getCurrentUserId,
  getRlsBootstrap,
  getSynchronousTenantFallback,
  getTenantRequestContext,
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

/** Last-resort user id when ALS is lost in pool callbacks (set from controllers/guards). */
let lastKnownUserIdForGuc = '';

/** Last-resort org id when ALS is lost in pool callbacks (set from guards). */
let lastKnownOrganisationIdForGuc = '';

export function setLastKnownUserIdForGuc(userId: string): void {
  lastKnownUserIdForGuc = userId;
}

export function clearLastKnownUserIdForGuc(): void {
  lastKnownUserIdForGuc = '';
}

export function setLastKnownOrganisationIdForGuc(organisationId: string): void {
  lastKnownOrganisationIdForGuc = organisationId;
}

export function clearLastKnownOrganisationIdForGuc(): void {
  lastKnownOrganisationIdForGuc = '';
}

/** Wired from {@link patchPostgresQueryRunnerForTenantGucs} to avoid recursive query patching. */
export function setGucQueryRunner(runner: GucQueryFn): void {
  runGucQuery = runner;
}

function resolveTenantGucValues(): [string, string, string] {
  const tenant = getTenantRequestContext();
  const fallback = getSynchronousTenantFallback();
  const orgId =
    getCurrentOrganisationId() ??
    tenant?.currentOrganisationId ??
    fallback.currentOrganisationId ??
    lastKnownOrganisationIdForGuc ??
    '';
  const userId =
    getCurrentUserId() ??
    tenant?.currentUserId ??
    fallback.currentUserId ??
    lastKnownUserIdForGuc ??
    '';
  const bootstrap =
    getRlsBootstrap() || tenant?.rlsBootstrap || fallback.rlsBootstrap === true
      ? '1'
      : '0';
  return [orgId, userId, bootstrap];
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
