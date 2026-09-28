import { User } from '../../users/entities/user.entity.js';

/**
 * `req.user` after JwtStrategy: optional active-org context mirrored from JWT (`orgId` → `organisationId`).
 */
export type AuthenticatedUser = User & {
  organisationId?: string;
  roles?: string[];
  /**
   * PRD §7.2 — mirrored from the `mfaEnrol` claim. True when this account
   * must enrol in MFA before `JwtAuthGuard` will serve it anything but the
   * enrolment routes.
   */
  mfaEnrolmentRequired?: boolean;
};
