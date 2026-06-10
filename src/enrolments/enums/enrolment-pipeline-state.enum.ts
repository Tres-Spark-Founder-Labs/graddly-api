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
