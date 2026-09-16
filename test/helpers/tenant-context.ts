import { enterCorrelationContext } from '../../src/common/context/correlation-id-context.js';

/**
 * Enters a tenant store for the remainder of the calling test's async chain,
 * for a test that calls a service or repository directly — standing in for
 * the job or request that would carry the store in production.
 *
 * The setters (`setCurrentOrganisationId`, `setCurrentUserId`) write the
 * store and nothing else, so outside one they are no-ops and the GUC resolver
 * sends '' — which matches no policy. Tests used to call them at the top of a
 * test body and work anyway, because the resolver fell through to a
 * process-global fallback; that fallback is gone, so a test that runs
 * tenant-scoped code outside a request enters its own store here.
 *
 * `enterWith` binds the store to the current async context and everything it
 * goes on to await, and does not reach the server's request handling, which
 * runs in its own contexts under CorrelationIdMiddleware.
 */
export function enterTenantContext(init: {
  label: string;
  organisationId?: string;
  userId?: string;
}): void {
  enterCorrelationContext({
    correlationId: `${init.label}-${Date.now()}`,
    label: init.label,
    currentOrganisationId: init.organisationId,
    currentUserId: init.userId,
  });
}
