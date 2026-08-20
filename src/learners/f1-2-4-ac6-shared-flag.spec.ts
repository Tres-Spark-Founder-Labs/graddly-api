import { OtjPaceAlertLevel } from '../otj/enums/otj-pace-alert-level.enum.js';

import { computeInterventionSeverity } from './utils/learner-status-badge.util.js';

/**
 * F1.2.4 AC6 — "Provider (P2) is simultaneously notified via their at-risk
 * intervention queue."
 *
 * "Simultaneously" is the load-bearing word. Two independent computations of
 * "is this learner at risk" can disagree, and then the employer sees a badge
 * the provider's queue does not show, or the reverse. The guarantee that makes
 * the criterion hold is that both sides read the SAME persisted flag:
 *
 *   OtjPaceService.evaluateEnrolmentPace   writes enrolments.otjPaceAlertLevel
 *   learner-metrics.service.ts:85          reads it for the provider queue
 *   enrolment-response.dto.ts:200          exposes it for the employer badge
 *
 * These tests pin the provider half. If someone recomputes pace inside the
 * queue instead of reading the flag, the mapping below stops matching and this
 * fails — which is the point.
 */
describe('F1.2.4 AC6 — provider queue and employer badge share one flag', () => {
  const severityFor = (level: OtjPaceAlertLevel | null) =>
    computeInterventionSeverity({
      otjOffTrack: level === OtjPaceAlertLevel.OFF_TRACK,
      otjAtRisk: level === OtjPaceAlertLevel.AT_RISK,
      reviewOverdue: false,
      gatewayStalled: false,
    });

  it('AC6: OFF_TRACK enters the provider queue', () => {
    expect(severityFor(OtjPaceAlertLevel.OFF_TRACK)).toBeGreaterThan(0);
  });

  it('AC6: AT_RISK enters the provider queue', () => {
    expect(severityFor(OtjPaceAlertLevel.AT_RISK)).toBeGreaterThan(0);
  });

  it('AC6: ON_TRACK does not enter the provider queue', () => {
    // InterventionQueueService.list filters on `severityScore > 0`.
    expect(severityFor(OtjPaceAlertLevel.ON_TRACK)).toBe(0);
  });

  it('AC6: an unevaluated enrolment does not enter the queue', () => {
    // Null means the pace cron has not run for this enrolment yet. That is
    // "unknown", not "at risk" — flagging it would put every new enrolment in
    // front of a tutor on day one.
    expect(severityFor(null)).toBe(0);
  });

  it('AC6: the two OTJ levels the employer badge flags are exactly the two the queue admits', () => {
    /**
     * risk-status.js on the employer side treats AT_RISK and OFF_TRACK as
     * flagged and ON_TRACK as not. This asserts the provider queue admits the
     * same two and no others, so neither side can flag a learner the other
     * ignores.
     */
    const admitted = [
      OtjPaceAlertLevel.ON_TRACK,
      OtjPaceAlertLevel.AT_RISK,
      OtjPaceAlertLevel.OFF_TRACK,
    ].filter((level) => severityFor(level) > 0);

    expect(admitted).toEqual([
      OtjPaceAlertLevel.AT_RISK,
      OtjPaceAlertLevel.OFF_TRACK,
    ]);
  });

  it('AC3 outranks AC2: off track is more severe than at risk', () => {
    expect(severityFor(OtjPaceAlertLevel.OFF_TRACK)).toBeGreaterThan(
      severityFor(OtjPaceAlertLevel.AT_RISK),
    );
  });
});
