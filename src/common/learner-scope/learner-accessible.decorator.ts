import { SetMetadata } from '@nestjs/common';

export const LEARNER_ACCESSIBLE_KEY = 'learnerAccessible';

/**
 * Marks a route a learner is allowed to reach at all.
 *
 * `LearnerScopeInterceptor` denies every organisation-scoped route to a
 * learner *unless* it carries this decorator. That direction is the whole
 * point: the exposure this fixes existed because reachability was the default
 * and scoping was something each endpoint had to remember. Inverting it means
 * a route added next year is closed to learners until somebody decides
 * otherwise, rather than open until somebody notices.
 *
 * Marking a route says only "a learner may call this". It does **not** say the
 * response is scoped to them. Routes that return per-learner collections must
 * additionally narrow their query through `LearnerScopeService.ownEnrolmentIds`
 * (or `ownApprenticeIds`) — the interceptor cannot do that for them, because it
 * does not know which column of which table carries the owner.
 *
 * The list of decorated routes was derived from the apprentice app's own
 * request paths rather than guessed, so it describes what the portal actually
 * uses.
 */
export const LearnerAccessible = () =>
  SetMetadata(LEARNER_ACCESSIBLE_KEY, true);
