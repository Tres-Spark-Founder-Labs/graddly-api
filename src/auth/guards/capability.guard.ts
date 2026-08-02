import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { rolesSatisfyCapability } from '../capabilities/capability-roles.js';
import { CAPABILITY_KEY } from '../capabilities/requires-capability.decorator.js';

import type { Capability } from '../capabilities/capability.enum.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

/**
 * Enforces {@link RequiresCapability}. Use after {@link JwtAuthGuard} and
 * {@link ActiveOrganisationGuard} so `req.user.roles` reflects the active
 * organisation rather than some other membership.
 *
 * Deliberately separate from `RolesGuard` rather than folded into it: the two
 * express different things. `@Roles(...)` hard-codes an answer at the call
 * site; a capability names the action and resolves the answer centrally, so
 * the client's decision moves one line instead of many.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability | undefined>(
      CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const roles = request.user?.roles ?? [];

    if (!rolesSatisfyCapability(roles, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
