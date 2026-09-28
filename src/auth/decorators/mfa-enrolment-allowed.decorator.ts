import { SetMetadata } from '@nestjs/common';

export const MFA_ENROLMENT_ALLOWED = 'mfaEnrolmentAllowed';

/**
 * Serves this route to an account that still owes MFA enrolment (PRD §7.2).
 *
 * The requirement is enforced in `JwtAuthGuard`, so it reaches every
 * authenticated route by default and a new controller is covered without
 * anyone remembering to cover it. That default is only safe if the routes
 * enrolment itself needs are exempt, which is what this marks.
 *
 * Keep the list short, and read it as the answer to "what can a locked-out
 * administrator still do?" — enrol, confirm, see who they are, and sign out.
 * Anything else added here widens the hole the control exists to close.
 */
export const MfaEnrolmentAllowed = () =>
  SetMetadata(MFA_ENROLMENT_ALLOWED, true);
