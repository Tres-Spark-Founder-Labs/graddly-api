import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { OrganisationRole } from '../../organisations/organisation-role.enum.js';
import { CAPABILITY_ROLES } from '../capabilities/capability-roles.js';
import { Capability } from '../capabilities/capability.enum.js';

import { CapabilityGuard } from './capability.guard.js';

function contextFor(roles: string[]): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('CapabilityGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new CapabilityGuard(reflector);

  beforeEach(() => jest.clearAllMocks());

  const requireCapability = (capability: Capability | undefined) =>
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(capability);

  it('allows a route with no capability metadata', () => {
    requireCapability(undefined);

    expect(guard.canActivate(contextFor([]))).toBe(true);
  });

  it('allows a role the capability permits', () => {
    requireCapability(Capability.SUBMIT_ILR);

    expect(guard.canActivate(contextFor([OrganisationRole.ADMIN]))).toBe(true);
  });

  /**
   * The point of the whole layer: an ILR submission is a funding claim, so a
   * plain member must not be able to file one — regardless of how the client
   * eventually maps their five job titles.
   */
  it('refuses a role the capability does not permit', () => {
    requireCapability(Capability.SUBMIT_ILR);

    expect(() =>
      guard.canActivate(contextFor([OrganisationRole.MEMBER])),
    ).toThrow(ForbiddenException);
  });

  it('refuses a request with no roles at all', () => {
    requireCapability(Capability.MANAGE_QIP);

    expect(() => guard.canActivate(contextFor([]))).toThrow(ForbiddenException);
  });

  it('allows when any one of several roles satisfies the capability', () => {
    requireCapability(Capability.MANAGE_QIP);

    expect(
      guard.canActivate(
        contextFor(['some_other_role', OrganisationRole.OWNER]),
      ),
    ).toBe(true);
  });
});

describe('CAPABILITY_ROLES', () => {
  it('covers every capability, so none can silently deny everyone', () => {
    for (const capability of Object.values(Capability)) {
      expect(CAPABILITY_ROLES[capability]).toBeDefined();
      expect(CAPABILITY_ROLES[capability].length).toBeGreaterThan(0);
    }
  });

  /**
   * Owner is the account that can grant permissions, so a capability it
   * cannot perform would be unreachable by anyone in the organisation.
   */
  it('always includes OWNER', () => {
    for (const capability of Object.values(Capability)) {
      expect(CAPABILITY_ROLES[capability]).toContain(OrganisationRole.OWNER);
    }
  });

  /**
   * Pins the answers that carry money or audit consequences, so widening one
   * has to be a deliberate edit to this test as well as to the map.
   */
  it('keeps the consequential actions off MEMBER', () => {
    for (const capability of [
      Capability.SUBMIT_ILR,
      Capability.WITHDRAW_LEARNER,
      Capability.MANAGE_QIP,
      Capability.MANAGE_STAFF,
    ]) {
      expect(CAPABILITY_ROLES[capability]).not.toContain(
        OrganisationRole.MEMBER,
      );
    }
  });
});
