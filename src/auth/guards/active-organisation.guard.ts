import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

import { setCurrentOrganisationId } from '../../common/context/correlation-id-context.js';
import { ActiveOrganisationResolver } from '../active-organisation.resolver.js';

import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

/**
 * After `JwtAuthGuard`, optionally applies `X-Organisation-Id`, then requires a resolved
 * `organisationId` on `req.user`.
 */
@Injectable()
export class ActiveOrganisationGuard implements CanActivate {
  constructor(
    private readonly activeOrganisationResolver: ActiveOrganisationResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    await this.activeOrganisationResolver.applyHeaderOverride(request);

    const user = request.user as AuthenticatedUser | undefined;
    if (!user?.organisationId) {
      throw new ForbiddenException('No active organisation context');
    }

    setCurrentOrganisationId(user.organisationId);
    return true;
  }
}
