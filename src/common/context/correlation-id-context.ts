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
  /** When true, RLS bootstrap policies apply (public auth routes). */
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
