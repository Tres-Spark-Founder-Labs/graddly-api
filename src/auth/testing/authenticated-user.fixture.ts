import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

/**
 * An `AuthenticatedUser` for a unit test, from the two or three fields the
 * test actually cares about.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `AuthenticatedUser` is `User & { organisationId?, roles? }`, so it carries
 * every column of the users table. Specs stood in `{ id, organisationId } as
 * const` instead, which is what the service reads — and 134 of the 241
 * `tsc --noEmit` errors in this repository were that one literal, in 19
 * files, reported at every call site. ts-jest transpiles without type
 * checking, so none of them failed a run; they were a real signal nobody
 * acted on.
 *
 * The cast is here, once, in a file whose whole purpose is to say what it is:
 * a partial row standing in for a request's user in a unit test. The
 * alternative — widening the parameter types of nineteen services to the
 * fields they happen to use — is production code changed to suit its tests.
 *
 * Do not use it in e2e specs: those have real users, from
 * `createVerifiedUser`.
 */
export function testAuthenticatedUser(
  fields: Partial<AuthenticatedUser> & { id: string },
): AuthenticatedUser {
  return fields as AuthenticatedUser;
}
