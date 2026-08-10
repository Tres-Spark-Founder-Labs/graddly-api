import { LearnerScopeService } from '../../src/common/learner-scope/learner-scope.service.js';

/**
 * The default `LearnerScopeService` double for unit specs: **staff**.
 *
 * `ownEnrolmentIds` resolving to `null` is the "do not narrow" signal, so every
 * pre-existing spec keeps the exact behaviour it had before learner scoping
 * existed. That is deliberate — those specs assert provider and employer
 * behaviour, and silently narrowing them would have turned a passing suite into
 * a suite that no longer tests what its names claim.
 *
 * A spec that wants the learner path calls {@link learnerScopeFor} instead, so
 * the learner case is always opted into explicitly and is visible at the call
 * site rather than inherited from a default.
 *
 * Kept here rather than repeated in each spec's provider array: it appears in
 * six suites, and six copies of an authorisation double is how they drift apart
 * until one of them is quietly wrong.
 */
export function staffLearnerScopeProvider() {
  return {
    provide: LearnerScopeService,
    useValue: {
      resolve: jest.fn().mockResolvedValue({
        isLearner: false,
        enrolmentIds: [],
        apprenticeIds: [],
      }),
      ownEnrolmentIds: jest.fn().mockResolvedValue(null),
      ownApprenticeIds: jest.fn().mockResolvedValue(null),
    },
  };
}

/** A learner who owns exactly the enrolments and apprentice records given. */
export function learnerScopeFor(
  enrolmentIds: string[],
  apprenticeIds: string[] = [],
) {
  return {
    provide: LearnerScopeService,
    useValue: {
      resolve: jest
        .fn()
        .mockResolvedValue({ isLearner: true, enrolmentIds, apprenticeIds }),
      ownEnrolmentIds: jest.fn().mockResolvedValue(enrolmentIds),
      ownApprenticeIds: jest.fn().mockResolvedValue(apprenticeIds),
    },
  };
}
