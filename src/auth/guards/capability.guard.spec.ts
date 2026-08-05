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

  /**
   * Security hardening pass, item 3 — the mapping, pinned exactly.
   *
   * Item 3 replaced 16 `@Roles(...)` decorators with named capabilities. That
   * was a behaviour-preserving refactor, and this table is what keeps it one:
   * every entry below is the exact role list the endpoint enforced before.
   *
   * A future change to any of these — widening a capability to MEMBER, say —
   * now has to be a deliberate edit here, visible in the diff, rather than a
   * one-word change in a mapping file that nothing asserts.
   */
  it('pins the exact role list of every capability', () => {
    const OWNER_ADMIN = [OrganisationRole.OWNER, OrganisationRole.ADMIN];
    const ALL_THREE = [
      OrganisationRole.OWNER,
      OrganisationRole.ADMIN,
      OrganisationRole.MEMBER,
    ];

    const expected: Record<Capability, OrganisationRole[]> = {
      // Pre-existing, from the capability-layer groundwork.
      [Capability.SUBMIT_ILR]: OWNER_ADMIN,
      [Capability.WITHDRAW_LEARNER]: OWNER_ADMIN,
      [Capability.MANAGE_QIP]: OWNER_ADMIN,
      [Capability.COMPLETE_QIP_ACTION]: ALL_THREE,
      [Capability.MANAGE_SAR]: OWNER_ADMIN,
      [Capability.RECORD_REVIEW]: ALL_THREE,
      [Capability.APPROVE_OTJ]: ALL_THREE,
      [Capability.DOWNLOAD_EVIDENCE_PACK]: ALL_THREE,
      [Capability.MANAGE_STAFF]: OWNER_ADMIN,

      // Added by item 3, each carrying its replaced decorator's role list.
      [Capability.READ_AUDIT_TRAIL]: OWNER_ADMIN,
      [Capability.RESOLVE_FUNDING_CLAIM]: OWNER_ADMIN,
      [Capability.MANAGE_ILR_MAPPING]: OWNER_ADMIN,
      [Capability.MANAGE_TUTOR_CASELOAD]: OWNER_ADMIN,
      [Capability.GENERATE_EVIDENCE_PACK]: OWNER_ADMIN,
      [Capability.MANAGE_ORGANISATION]: OWNER_ADMIN,
      [Capability.BULK_APPROVE_OTJ]: OWNER_ADMIN,
      [Capability.MANAGE_REPORT_SUBSCRIPTIONS]: OWNER_ADMIN,
      [Capability.MANAGE_SURVEYS]: OWNER_ADMIN,
    };

    for (const capability of Object.values(Capability)) {
      expect([...CAPABILITY_ROLES[capability]].sort()).toEqual(
        [...expected[capability]].sort(),
      );
    }
  });

  /**
   * The two near-misses recorded in capability-roles.ts. Folding either pair
   * together during the refactor would have granted MEMBER a permission it
   * does not have today, so the difference is asserted rather than trusted to
   * a comment — this pass has twice found comments describing behaviour the
   * adjacent code did not have.
   */
  it('keeps the narrow siblings narrower than their wide counterparts', () => {
    expect(CAPABILITY_ROLES[Capability.GENERATE_EVIDENCE_PACK]).not.toContain(
      OrganisationRole.MEMBER,
    );
    expect(CAPABILITY_ROLES[Capability.DOWNLOAD_EVIDENCE_PACK]).toContain(
      OrganisationRole.MEMBER,
    );

    expect(CAPABILITY_ROLES[Capability.BULK_APPROVE_OTJ]).not.toContain(
      OrganisationRole.MEMBER,
    );
    expect(CAPABILITY_ROLES[Capability.APPROVE_OTJ]).toContain(
      OrganisationRole.MEMBER,
    );
  });
});
