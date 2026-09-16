import { AsyncLocalStorage } from 'async_hooks';

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
  /**
   * When true, RLS bootstrap policies apply: public auth routes, which have no
   * organisation to scope by, and display-name hydration. No third use without
   * reading {@link setRlsBootstrap}.
   */
  rlsBootstrap?: boolean;
}

const storage = new AsyncLocalStorage<ICorrelationIdStore>();

export interface ITenantRequestContext {
  currentOrganisationId?: string;
  currentUserId?: string;
  rlsBootstrap?: boolean;
}

const tenantByCorrelationId = new Map<string, ITenantRequestContext>();

/** Fallback when TypeORM/pg runs outside the ALS continuation (e.g. pool callbacks). */
let synchronousTenantFallback: ITenantRequestContext = {};

export function resetSynchronousTenantFallback(): void {
  synchronousTenantFallback = {};
}

export function getSynchronousTenantFallback(): ITenantRequestContext {
  return synchronousTenantFallback;
}

export function setTenantRequestContext(partial: ITenantRequestContext): void {
  synchronousTenantFallback = {
    ...synchronousTenantFallback,
    ...partial,
  };
  const correlationId = getCorrelationId();
  if (!correlationId) {
    return;
  }
  const previous = tenantByCorrelationId.get(correlationId) ?? {};
  tenantByCorrelationId.set(correlationId, { ...previous, ...partial });
}

export function getTenantRequestContext(): ITenantRequestContext | undefined {
  const store = storage.getStore();
  if (store) {
    return {
      currentOrganisationId: store.currentOrganisationId,
      currentUserId: store.currentUserId,
      rlsBootstrap: store.rlsBootstrap,
    };
  }
  const correlationId = getCorrelationId();
  const fromMap = correlationId
    ? tenantByCorrelationId.get(correlationId)
    : undefined;
  if (fromMap) {
    return fromMap;
  }
  if (Object.keys(synchronousTenantFallback).length > 0) {
    return synchronousTenantFallback;
  }
  return undefined;
}

export function clearTenantRequestContext(correlationId: string): void {
  tenantByCorrelationId.delete(correlationId);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function getCurrentOrganisationId(): string | undefined {
  return storage.getStore()?.currentOrganisationId;
}

export function setCurrentOrganisationId(id: string | undefined): void {
  const store = storage.getStore();
  if (store) {
    store.currentOrganisationId = id;
  }
  setTenantRequestContext({ currentOrganisationId: id });
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

export function setCurrentUserId(id: string | undefined): void {
  const store = storage.getStore();
  if (store) {
    store.currentUserId = id;
  }
  setTenantRequestContext({ currentUserId: id });
}

export function getRlsBootstrap(): boolean {
  return storage.getStore()?.rlsBootstrap === true;
}

/**
 * Turn the RLS bootstrap flag on or off for the remainder of this request.
 *
 * ── THIS IS A BYPASS ────────────────────────────────────────────────────────
 *
 * `app_rls_bootstrap()` is the first arm of `users_select`,
 * `organisation_memberships_select`, `ks_evidence_items_select` and others, so
 * while it is set those policies admit rows on the id alone. Three uses are
 * legitimate:
 *
 *   public auth routes      no organisation exists yet, so nothing can be
 *                           scoped by one
 *   display-name hydration  a label rendered beside a record the caller may
 *                           already read
 *   counterparty reads      one named field of a row belonging to the other
 *                           party to a record the caller is provably party
 *                           to, where that party's own table admits only its
 *                           members
 *
 * The rules are the same for both of the last two, they are not optional, and
 * they are written out in `docs/employer-learner-access.md`, "Bootstrap is
 * for named, narrow reads":
 *
 *   1. Named columns only — a `select` listing exactly the fields needed.
 *      Never a whole row, never a list, never a count.
 *   2. Exclusive, not brief: A BOOTSTRAP WINDOW MAY CONTAIN ONLY READS THAT
 *      ARE MEANT TO BYPASS. The flag is request-global — it holds for every
 *      statement the request sends while it is set, not for the lines between
 *      set and restore — so a window three lines long is no safer than a long
 *      one. What matters is what else is in flight. A loader called inside a
 *      Promise.all beside a scoped read makes that read a bypass: the
 *      profile's evidence read did exactly that, and owner-only portfolio
 *      evidence appeared in an employer's library. `enrichEnrolmentsForDisplay`
 *      runs a Promise.all *inside* its window and is safe, because every read
 *      in that batch is display hydration. Windows must not overlap either:
 *      each restores the value it found, so two open at once can restore out
 *      of order and leave the flag on after both have finished.
 *      `bootstrap-window-exclusivity.spec.ts` enforces this on every
 *      request-path file.
 *   3. After an authorisation check, not instead of one. Under this flag the
 *      ids ARE the access decision, so they must come from rows the caller has
 *      already read under its own policy — and for a counterparty read, the
 *      caller's right to the record must already be established.
 *   4. Nothing a decision is taken on that the caller could not otherwise
 *      have. A label, or a field the counterparty relationship entitles them
 *      to; not a row they are merely curious about.
 *
 * `LearnerMetricsService.loadTutorNames` is the worked example for a display
 * name and `LevyTransferService.recipientUkprn` for a counterparty field;
 * `learner-metrics.service.spec.ts`, `levy-transfer.service.spec.ts` and
 * `levy-transfer-funding.service.spec.ts` assert every clause.
 *
 * What this flag is never for: a whole request. `rls-bootstrap.middleware.ts`
 * once turned it on for every POST under `/levy-exchange/transfers`, which
 * disabled the tenant boundary on four routes to serve two reads.
 *
 * Restore the previous value in a `finally` rather than setting `false`, or a
 * nested call switches the flag off under its caller.
 */
export function setRlsBootstrap(enabled: boolean): void {
  const store = storage.getStore();
  if (store) {
    store.rlsBootstrap = enabled;
  }
  setTenantRequestContext({ rlsBootstrap: enabled });
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
