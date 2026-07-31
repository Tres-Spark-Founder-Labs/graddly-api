import {
  ACCEPTED_PROVIDER_PIPELINE_STATES,
  ENROLMENT_PIPELINE_ORDER,
  EnrolmentPipelineState,
} from './enrolment-pipeline-state.enum.js';

/**
 * F1.2.5 AC5 names the five states, and AC2 depends on knowing which of them
 * mean the provider has accepted.
 */
describe('enrolment pipeline states', () => {
  it('covers exactly the five states the criterion lists', () => {
    expect(Object.values(EnrolmentPipelineState)).toEqual([
      'invited',
      'account_created',
      'provider_accepted',
      'ilr_created',
      'das_confirmed',
    ]);
  });

  it('orders them monotonically', () => {
    const order = Object.values(EnrolmentPipelineState).map(
      (state) => ENROLMENT_PIPELINE_ORDER[state],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe('ACCEPTED_PROVIDER_PIPELINE_STATES (AC2)', () => {
    it('includes provider_accepted and everything after it', () => {
      // An enrolment that has moved on to ILR or DAS was still accepted — a
      // hand-written list containing only `provider_accepted` would drop the
      // employer's longest-standing providers from the picker.
      expect(ACCEPTED_PROVIDER_PIPELINE_STATES).toEqual([
        EnrolmentPipelineState.PROVIDER_ACCEPTED,
        EnrolmentPipelineState.ILR_CREATED,
        EnrolmentPipelineState.DAS_CONFIRMED,
      ]);
    });

    it('excludes the states before acceptance', () => {
      expect(ACCEPTED_PROVIDER_PIPELINE_STATES).not.toContain(
        EnrolmentPipelineState.INVITED,
      );
      expect(ACCEPTED_PROVIDER_PIPELINE_STATES).not.toContain(
        EnrolmentPipelineState.ACCOUNT_CREATED,
      );
    });

    it('is initialised, not left undefined by declaration order', () => {
      // It is derived from ENROLMENT_PIPELINE_ORDER, which sits in the
      // temporal dead zone until declared — reading it too early throws at
      // import rather than at first use.
      expect(ACCEPTED_PROVIDER_PIPELINE_STATES).toHaveLength(3);
    });
  });
});
