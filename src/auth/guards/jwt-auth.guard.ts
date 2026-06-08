import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../../common/context/correlation-id-context.js';
import {
  setLastKnownOrganisationIdForGuc,
  setLastKnownUserIdForGuc,
} from '../../database/apply-tenant-gucs.js';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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
      setLastKnownUserIdForGuc(authUser.id);
    }
    if (authUser.organisationId) {
      setCurrentOrganisationId(authUser.organisationId);
      setLastKnownOrganisationIdForGuc(authUser.organisationId);
    }

    return user;
  }
}
