/** Cross-portal enrolment pipeline sub-states (monotonic forward progression). */
export enum EnrolmentPipelineState {
  INVITED = 'invited',
  ACCOUNT_CREATED = 'account_created',
  PROVIDER_ACCEPTED = 'provider_accepted',
  ILR_CREATED = 'ilr_created',
  DAS_CONFIRMED = 'das_confirmed',
}

export const ENROLMENT_PIPELINE_ORDER: Record<EnrolmentPipelineState, number> =
  {
    [EnrolmentPipelineState.INVITED]: 1,
    [EnrolmentPipelineState.ACCOUNT_CREATED]: 2,
    [EnrolmentPipelineState.PROVIDER_ACCEPTED]: 3,
    [EnrolmentPipelineState.ILR_CREATED]: 4,
    [EnrolmentPipelineState.DAS_CONFIRMED]: 5,
  };

/**
 * States that mean the provider has accepted (F1.2.5 AC2).
 *
 * Derived from the order above rather than listed by hand, so a state added
 * after `das_confirmed` cannot silently drop out of the set.
 *
 * Declared after `ENROLMENT_PIPELINE_ORDER` deliberately: `const` bindings sit
 * in the temporal dead zone until initialised, so reading it above would throw
 * at import time rather than at first use.
 */
export const ACCEPTED_PROVIDER_PIPELINE_STATES: EnrolmentPipelineState[] =
  Object.values(EnrolmentPipelineState).filter(
    (state) =>
      ENROLMENT_PIPELINE_ORDER[state] >=
      ENROLMENT_PIPELINE_ORDER[EnrolmentPipelineState.PROVIDER_ACCEPTED],
  );
