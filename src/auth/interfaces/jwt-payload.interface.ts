/**
 * Signed access-token claims. `orgId` / `roles` are omitted when the user has no active membership.
 */
export interface IJwtPayload {
  sub: string;
  email: string;
  /** Active organisation id (tenant context). */
  orgId?: string;
  /** Roles in the active organisation (typically one entry today). */
  roles?: string[];

  /**
   * PRD §7.2 — this account holds owner or admin in a provider or employer
   * organisation and has not enrolled in MFA, so `MfaEnrolmentGuard` serves
   * it nothing but the enrolment endpoints.
   *
   * Carried as a claim rather than recomputed per request: the memberships it
   * derives from are already loaded when tokens are issued, so the claim is
   * free, and the alternative is a membership query on every authenticated
   * call. It is recomputed on every refresh, which bounds staleness to one
   * access-token lifetime in both directions — a user who gains an admin role
   * mid-session is required to enrol within 15 minutes, and one who has just
   * enrolled is not held back, because the guard also checks the live
   * `mfaEnabled` before refusing.
   */
  mfaEnrol?: boolean;
}
