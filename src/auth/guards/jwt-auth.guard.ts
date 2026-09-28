import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import { AuthErrorCode } from '../auth-error-codes.js';
import { MFA_ENROLMENT_ALLOWED } from '../decorators/mfa-enrolment-allowed.decorator.js';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super();
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    super.handleRequest(err, user, info, context, status);

    const authUser = user as unknown as AuthenticatedUser;
    if (authUser.id) {
      setCurrentUserId(authUser.id);
    }
    if (authUser.organisationId) {
      setCurrentOrganisationId(authUser.organisationId);
    }

    this.assertMfaEnrolled(authUser, context);

    return user;
  }

  /**
   * PRD §7.2 — "MFA required for provider and employer admin accounts".
   *
   * ── WHY HERE ────────────────────────────────────────────────────────────
   *
   * This guard is on effectively every authenticated controller, so enforcing
   * from it means a new controller is covered the day it is written rather
   * than the day someone remembers. A global guard cannot do this: globals
   * run before the route guards, so `request.user` would not exist yet.
   *
   * ── WHAT IT COSTS, WHICH IS NOTHING ─────────────────────────────────────
   *
   * Two field reads. `mfaEnrolmentRequired` is a claim computed when the
   * token was issued, from memberships the token issuer had already loaded,
   * and `mfaEnabled` comes off the user the strategy has already fetched. No
   * query is added to any request.
   *
   * ── WHY BOTH THE CLAIM AND THE LIVE FLAG ────────────────────────────────
   *
   * The claim can be stale for up to one access-token lifetime. Checking the
   * live `mfaEnabled` as well means someone who has just enrolled is served
   * immediately rather than waiting 15 minutes for a token that agrees with
   * them — and someone who has just gained an admin role is required to enrol
   * within 15 minutes rather than never.
   *
   * The configuration flag is re-read here rather than trusted from the
   * claim, so that setting `MFA_REQUIRED_FOR_ADMINS=false` relieves a
   * mistaken lock-out on the next request instead of after every live token
   * has rotated. That is the rollback lever, and a rollback that takes 15
   * minutes is not one.
   */
  private assertMfaEnrolled(
    user: AuthenticatedUser,
    context: ExecutionContext,
  ): void {
    if (!this.config.get<boolean>('app.security.mfaRequiredForAdmins', true)) {
      return;
    }
    if (!user.mfaEnrolmentRequired || user.mfaEnabled) {
      return;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      MFA_ENROLMENT_ALLOWED,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) {
      return;
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message:
        'Multi-factor authentication is required for this account. Complete ' +
        'enrolment to continue.',
      code: AuthErrorCode.MFA_ENROLMENT_REQUIRED,
    });
  }
}
