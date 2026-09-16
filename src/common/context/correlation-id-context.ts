import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'node:crypto';

import type { Request } from 'express';

export interface ICorrelationIdStore {
  correlationId: string;
  /** Active organisation UUID for optional Postgres RLS session var; set by ActiveOrganisationGuard. */
  currentOrganisationId?: string;
  /** Authenticated user UUID for Postgres RLS; set during JWT validation. */
  currentUserId?: string;
  /**
   * F1.3.3 AC2 — display name and organisation role of the acting user, for
   * audit entries. Not used for authorisation; the guards do that from the
   * JWT. These exist so the audit subscriber can record who acted without a
   * query per audited row.
   */
  currentActorName?: string;
  currentActorRole?: string;
  /** What this context is for — "GET /api/v1/learners/…" or "pdf:generate#42" — named in tenant warnings. */
  label?: string;
  /**
   * When true, RLS bootstrap policies apply. Set only by
   * {@link withRlsBootstrap}, which runs a callback in a store derived from
   * this one — never assigned on an existing store, which every sibling async
   * operation in the request already holds.
   */
  rlsBootstrap?: boolean;
}

const storage = new AsyncLocalStorage<ICorrelationIdStore>();

/**
 * ── WHY THERE IS NO FALLBACK ────────────────────────────────────────────────
 *
 * This module used to keep `synchronousTenantFallback` — one object for the
 * whole process, written by every setter below — and the GUC resolver read it
 * whenever the store had no organisation. So a request whose token carried no
 * organisation, or a worker job (which had no store at all), sent whichever
 * organisation another request or job had written last, and every row policy
 * then evaluated correctly against the wrong tenant. The same shape as the
 * bootstrap-flag leak, on the value every policy compares against.
 *
 * Gone, not deprecated: the store is the only place a tenant value lives.
 * Outside a store the setters are no-ops and the resolver sends '' — which
 * matches no policy, so a path that has not entered a context fails closed
 * and says so in the log. A job enters one with {@link runWithTenantContext};
 * a request has one from CorrelationIdMiddleware.
 * `rls-bootstrap-mechanism.spec.ts` fails if module-level tenant state comes
 * back here or in apply-tenant-gucs.ts.
 */
export interface ITenantContextInit {
  /** Named in warnings when a query runs without an organisation or user. */
  label: string;
  organisationId?: string;
  userId?: string;
  correlationId?: string;
}

/**
 * Runs `fn` in a fresh store carrying this job's tenant values — what
 * CorrelationIdMiddleware does for a request, for a BullMQ job or a cron.
 * Two jobs interleaving on one worker each keep their own store.
 */
export function runWithTenantContext<T>(
  init: ITenantContextInit,
  fn: () => T,
): T {
  return storage.run(
    {
      correlationId: init.correlationId ?? `${init.label}-${randomUUID()}`,
      label: init.label,
      currentOrganisationId: init.organisationId,
      currentUserId: init.userId,
    },
    fn,
  );
}

export function getContextLabel(): string | undefined {
  return storage.getStore()?.label;
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function getCurrentOrganisationId(): string | undefined {
  return storage.getStore()?.currentOrganisationId;
}

/** Store only. A no-op outside a store — see "why there is no fallback". */
export function setCurrentOrganisationId(id: string | undefined): void {
  const store = storage.getStore();
  if (store) {
    store.currentOrganisationId = id;
  }
}

/**
 * F1.3.3 AC2 — the acting user's name and role, for audit entries.
 *
 * Held on the request context rather than looked up per audit row. The audit
 * subscriber runs inside the same transaction as the write it is recording,
 * and issuing a `users` query there would add a round trip to every mutation
 * in the platform to satisfy a reporting requirement.
 *
 * Set once by the audit context interceptor from the already-authenticated
 * user, so it costs nothing.
 */
export function getCurrentActor(): {
  name?: string;
  role?: string;
} {
  const store = storage.getStore();
  return {
    name: store?.currentActorName,
    role: store?.currentActorRole,
  };
}

export function setCurrentActor(actor: { name?: string; role?: string }): void {
  const store = storage.getStore();
  if (store) {
    store.currentActorName = actor.name;
    store.currentActorRole = actor.role;
  }
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.currentUserId;
}

/** Store only. A no-op outside a store — see "why there is no fallback". */
export function setCurrentUserId(id: string | undefined): void {
  const store = storage.getStore();
  if (store) {
    store.currentUserId = id;
  }
}

export function getRlsBootstrap(): boolean {
  return storage.getStore()?.rlsBootstrap === true;
}

/**
 * Run `fn` with the RLS bootstrap flag set — and nothing else.
 *
 * ── THIS IS A BYPASS ────────────────────────────────────────────────────────
 *
 * `app_rls_bootstrap()` is the first arm of `users_select`,
 * `organisation_memberships_select`, `ks_evidence_items_select` and others, so
 * inside `fn` those policies admit rows on the id alone. The uses:
 *
 *   public auth routes      no organisation exists yet, so nothing can be
 *                           scoped by one (`rls-bootstrap.middleware.ts`)
 *   system jobs             a cron or processor discovering what to act on
 *   display-name hydration  a label rendered beside a record the caller may
 *                           already read
 *   counterparty reads      one named field of a row belonging to the other
 *                           party to a record the caller is provably party
 *                           to, where that party's own table admits only its
 *                           members
 *
 * ── WHY A CALLBACK, AND NOT A SETTER ────────────────────────────────────────
 *
 * This replaces `setRlsBootstrap(enabled)`, which assigned the flag on the
 * request's store — the one object every sibling async operation in the
 * request already held — and also wrote the process-global tenant fallback,
 * which the GUC resolver OR-ed in. So a window opened in a loader reached a
 * scoped read in its caller's Promise.all (owner-only evidence appeared in an
 * employer's profile); two windows restoring out of order could leave the flag
 * on; and while any window was open anywhere in the process, every concurrent
 * request ran with bypass on.
 *
 * `fn` now runs in a NEW store derived from the current one. Siblings keep the
 * store they already had, so they cannot see the flag. There is no restore, so
 * no ordering to get wrong. Nesting is free, and nothing process-global is
 * written. Outside any store — a cron — a store is created for the callback.
 *
 * Everything `fn` starts runs with the flag on, including a Promise.all inside
 * it. That is what moves the remaining rules from timing to content.
 *
 * The rules for display names and counterparty reads are not optional, and are
 * written out in `docs/employer-learner-access.md`, "Bootstrap is for named,
 * narrow reads":
 *
 *   1. Named columns only — a `select` listing exactly the fields needed.
 *      Never a whole row, never a list, never a count.
 *   2. Only reads that are meant to bypass go inside the callback. A read
 *      beside it runs in its own store and cannot be widened by it; a read
 *      inside it bypasses, whatever it is.
 *   3. After an authorisation check, not instead of one. Under this flag the
 *      ids ARE the access decision, so they must come from rows the caller has
 *      already read under its own policy — and for a counterparty read, the
 *      caller's right to the record must already be established.
 *   4. Nothing a decision is taken on that the caller could not otherwise
 *      have. A label, or a field the counterparty relationship entitles them
 *      to; not a row they are merely curious about.
 *
 * `LearnerMetricsService.loadTutorNames` is the worked example for a display
 * name and `LevyTransferService.recipientUkprn` for a counterparty field.
 * `bootstrap-window-exclusivity.spec.ts` forbids setting the flag any other
 * way.
 */
export function withRlsBootstrap<T>(fn: () => T): T {
  const current = storage.getStore();
  return storage.run(
    {
      ...(current ?? { correlationId: `rls-bootstrap-${randomUUID()}` }),
      rlsBootstrap: true,
    },
    fn,
  );
}

/** Prefer AsyncLocalStorage; fallback for code outside the request ALS callback. */
export function getRequestId(request: Request): string | undefined {
  const fromStore = getCorrelationId();
  if (fromStore) {
    return fromStore;
  }
  const header = request.get('x-request-id');
  return typeof header === 'string' && header.trim() !== ''
    ? header.trim()
    : undefined;
}

export function runWithCorrelationId<T>(
  correlationIdOrStore: string | ICorrelationIdStore,
  callback: () => T,
): T {
  const store: ICorrelationIdStore =
    typeof correlationIdOrStore === 'string'
      ? { correlationId: correlationIdOrStore }
      : correlationIdOrStore;
  return storage.run(store, callback);
}

/**
 * Binds the store for the remainder of the async request chain (Express + Nest).
 * Prefer this over {@link runWithCorrelationId} in HTTP middleware so context survives
 * after `next()` returns.
 */
export function enterCorrelationContext(
  correlationIdOrStore: string | ICorrelationIdStore,
): ICorrelationIdStore {
  const store: ICorrelationIdStore =
    typeof correlationIdOrStore === 'string'
      ? { correlationId: correlationIdOrStore }
      : correlationIdOrStore;
  storage.enterWith(store);
  return store;
}
