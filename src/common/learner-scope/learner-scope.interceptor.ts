import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, switchMap } from 'rxjs';

import { LEARNER_ACCESSIBLE_KEY } from './learner-accessible.decorator.js';
import { LearnerScopeService } from './learner-scope.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

/**
 * Client decision D3, enforced in one place: no learner may see, infer or
 * derive another learner's progress.
 *
 * ── WHY AN INTERCEPTOR AND NOT A GUARD ───────────────────────────────────────
 *
 * A guard is the natural shape for this and would be the wrong mechanism. Nest
 * runs globally-registered guards *before* controller-bound ones, so an
 * `APP_GUARD` here would execute ahead of `JwtAuthGuard` and
 * `ActiveOrganisationGuard` — `req.user` would still be undefined, the
 * principal would resolve as "not a learner", and the check would fail **open**
 * on every request. A global interceptor runs after the whole guard chain, so
 * `req.user.organisationId` and `req.user.roles` are populated by the time this
 * decides anything. Throwing before `next.handle()` denies the request exactly
 * as a guard would.
 *
 * ── WHY 404 AND NOT 403 ──────────────────────────────────────────────────────
 *
 * D3 states that "error and status responses must not differ between 'record
 * does not exist' and 'record exists but is not yours'". A 403 on
 * `/learners/cohort` tells a learner that a cohort endpoint exists and that
 * they are being kept out of it; a 404 tells them nothing they did not already
 * know. The same reasoning already governs the not-found responses on the
 * row-level reads, so the two agree instead of one leaking what the other
 * hides.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 *
 * It admits or refuses a *route*. It does not narrow *rows*. A learner allowed
 * onto `GET /otj-log-entries` still needs that query filtered to their own
 * enrolments, which happens in the service via `ownEnrolmentIds`. Both halves
 * are needed and they are tested separately.
 *
 * Routes with no active organisation — `/auth/*`, the public endpoints — are
 * outside this interceptor's remit by construction: learner status is resolved
 * per organisation, and without one there is no organisation-scoped read to
 * protect. Those routes are scoped by the authenticated principal already.
 */
@Injectable()
export class LearnerScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly learnerScope: LearnerScopeService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
      LEARNER_ACCESSIBLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowed) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user?.id || !user.organisationId) {
      return next.handle();
    }

    return from(this.learnerScope.resolve(user)).pipe(
      switchMap((scope) => {
        if (scope.isLearner) {
          throw new NotFoundException(this.unmatchedRouteMessage(context));
        }
        return next.handle();
      }),
    );
  }

  /**
   * Mirrors Nest's own unmatched-route message, verb included, so a route
   * refused to a learner is indistinguishable from one that was never mapped.
   */
  private unmatchedRouteMessage(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const method = (request.method ?? 'GET').toUpperCase();
    const path = request.originalUrl ?? request.url ?? '';
    return `Cannot ${method} ${path}`;
  }
}
