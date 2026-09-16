import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { withRlsBootstrap } from '../context/correlation-id-context.js';

/**
 * Every route whose requests run with the RLS bootstrap flag set — that is,
 * with row-level security OFF for the whole request.
 *
 * ── HOW AN ENTRY MATCHES ────────────────────────────────────────────────────
 *
 * Each entry is a route suffix, matched with `path.endsWith(suffix)` on the
 * request path. That anchors it to the end of a route. Nothing else in this
 * file matches a path, and nothing may: `rls-bootstrap.middleware.spec.ts`
 * fails on any other matching call in the source.
 *
 * This list used to be accompanied by an unanchored branch —
 * `if (path.includes('/levy-exchange/transfers')) return true;` — which turned
 * RLS off for every POST under that path: create, sign, submit and enrolment
 * links, with the service's `where` clauses the only tenant boundary, and an
 * e2e suite that passed a recipient's signature because of the bypass rather
 * than any policy. Those routes now run under RLS (migration 1781100000055).
 *
 * A parameterised route cannot be expressed here and must not be added by
 * other means: `endsWith('/enrolments')` would also match POST /enrolments. A
 * route that needs to act across a tenant line gets a policy or a
 * SECURITY DEFINER function with its own rule, as the transfer routes did.
 *
 * ── THE SPEC PINS THIS LIST ─────────────────────────────────────────────────
 *
 * Adding an entry turns RLS off for a route. The spec fails until someone
 * updates it on purpose, next to a comment here saying why that route cannot
 * run under RLS.
 */
export const RLS_BOOTSTRAP_ROUTES = Object.freeze({
  /** Public auth POSTs: there is no organisation yet to scope by. */
  authPost: Object.freeze([
    '/auth/signup',
    '/auth/login',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/resend-verification',
    '/invitations/accept',
    '/levy-exchange/matches/search',
    '/levy-exchange/match-applications',
  ]),
  /** OAuth callbacks arrive before any session exists. */
  authGet: Object.freeze([
    '/auth/oidc/callback',
    '/levy-exchange/donor-links/oauth/callback',
  ]),
  /** Platform operations that act across every organisation by design. */
  platformOpsPost: Object.freeze(['/platform/gdpr/erasure']),
});

function normalizeRequestPath(request: Request): string {
  const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
  return path.replace(/\/+$/, '') || '/';
}

function endsWithAny(path: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => path.endsWith(suffix));
}

export function isRlsBootstrapRequest(request: Request): boolean {
  const path = normalizeRequestPath(request);

  if (request.method === 'GET') {
    return endsWithAny(path, RLS_BOOTSTRAP_ROUTES.authGet);
  }

  if (request.method !== 'POST') {
    return false;
  }

  return (
    endsWithAny(path, RLS_BOOTSTRAP_ROUTES.platformOpsPost) ||
    endsWithAny(path, RLS_BOOTSTRAP_ROUTES.authPost)
  );
}

@Injectable()
export class RlsBootstrapMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (!isRlsBootstrapRequest(req)) {
      next();
      return;
    }

    // The rest of this request's pipeline runs inside a store derived from the
    // request's own, with the flag set. Scoped to this request by
    // construction: no other request's store is touched, and there is nothing
    // to clear on `finish`, so the old hazard — a clear landing after the next
    // request had started — cannot arise.
    withRlsBootstrap(() => next());
  }
}
