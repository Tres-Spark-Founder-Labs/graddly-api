import { ApprenticeStatus } from '../../apprentices/enums/apprentice-status.enum.js';
import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { ReviewStatus } from '../../reviews/enums/review-status.enum.js';

export enum LearnerStatusBadge {
  ON_TRACK = 'on_track',
  AT_RISK = 'at_risk',
  OVERDUE = 'overdue',
  BREAK_IN_LEARNING = 'break_in_learning',
  WITHDRAWN = 'withdrawn',
  EPA_READY = 'epa_ready',
  /**
   * NOT in F2.2.1 AC3. A recorded deviation (docs/prd/DEVIATIONS.md, D-01):
   * the learner's OTJ pace level is missing, so nothing is known to be wrong
   * and nothing is known to be fine. It used to fall through to ON_TRACK,
   * which told a provider a learner was on track when nobody knew.
   */
  PACE_UNKNOWN = 'pace_unknown',
}

/**
 * F2.2.1 AC3 wording, verbatim from the PRD — except "Pace Unknown", which
 * the PRD does not list (see PACE_UNKNOWN). Exported so the CSV and PDF
 * exports print what the screen prints — a document that says `at_risk` where
 * the dashboard says "At Risk" invites the reader to wonder if they are the
 * same thing.
 */
export const LEARNER_STATUS_BADGE_LABELS: Readonly<
  Record<LearnerStatusBadge, string>
> = Object.freeze({
  [LearnerStatusBadge.ON_TRACK]: 'On Track',
  [LearnerStatusBadge.AT_RISK]: 'At Risk',
  [LearnerStatusBadge.OVERDUE]: 'Overdue',
  [LearnerStatusBadge.BREAK_IN_LEARNING]: 'Break in Learning',
  [LearnerStatusBadge.WITHDRAWN]: 'Withdrawn',
  [LearnerStatusBadge.EPA_READY]: 'EPA Ready',
  [LearnerStatusBadge.PACE_UNKNOWN]: 'Pace Unknown',
});

export interface ILearnerStatusBadgeInput {
  apprenticeStatus: ApprenticeStatus;
  enrolmentStatus: EnrolmentStatus;
  otjPaceAlertLevel: OtjPaceAlertLevel | null;
  gatewayCompletionPercent: number;
  hasOverdueReview: boolean;
}

const REVIEW_OVERDUE_GRACE_DAYS = 3;

export function isReviewOverdueByPrd(
  scheduledAt: Date,
  status: ReviewStatus,
  now: Date = new Date(),
): boolean {
  if (status !== ReviewStatus.SCHEDULED) {
    return false;
  }
  const threshold = new Date(scheduledAt);
  threshold.setUTCDate(threshold.getUTCDate() + REVIEW_OVERDUE_GRACE_DAYS);
  return threshold < now;
}

export function deriveLearnerStatusBadge(
  input: ILearnerStatusBadgeInput,
): LearnerStatusBadge {
  if (
    input.apprenticeStatus === ApprenticeStatus.WITHDRAWN ||
    input.enrolmentStatus === EnrolmentStatus.CANCELLED
  ) {
    return LearnerStatusBadge.WITHDRAWN;
  }
  if (input.apprenticeStatus === ApprenticeStatus.PAUSED) {
    return LearnerStatusBadge.BREAK_IN_LEARNING;
  }
  if (input.gatewayCompletionPercent === 100) {
    return LearnerStatusBadge.EPA_READY;
  }
  if (input.hasOverdueReview) {
    return LearnerStatusBadge.OVERDUE;
  }
  if (
    input.otjPaceAlertLevel === OtjPaceAlertLevel.AT_RISK ||
    input.otjPaceAlertLevel === OtjPaceAlertLevel.OFF_TRACK
  ) {
    return LearnerStatusBadge.AT_RISK;
  }
  // On track is a finding, so it needs the pace to say so. A missing (or
  // unrecognised) level is unknown, not a default green.
  if (input.otjPaceAlertLevel === OtjPaceAlertLevel.ON_TRACK) {
    return LearnerStatusBadge.ON_TRACK;
  }
  return LearnerStatusBadge.PACE_UNKNOWN;
}

export function isGatewayStalled(
  epaDate: string | null,
  gatewayCompletionPercent: number,
  now: Date = new Date(),
): boolean {
  if (!epaDate || gatewayCompletionPercent >= 100) {
    return false;
  }
  const epa = new Date(`${epaDate}T00:00:00.000Z`);
  const daysToEpa = Math.ceil(
    (epa.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysToEpa <= 90 && daysToEpa >= 0;
}

export enum InterventionFlagReason {
  OTJ_BEHIND = 'otj_behind',
  MISSED_REVIEW = 'missed_review',
  GATEWAY_STALLED = 'gateway_stalled',
}

export function computeInterventionSeverity(flags: {
  otjOffTrack: boolean;
  reviewOverdue: boolean;
  gatewayStalled: boolean;
  otjAtRisk: boolean;
}): number {
  if (flags.otjOffTrack) return 100;
  if (flags.reviewOverdue) return 85;
  if (flags.gatewayStalled) return 70;
  if (flags.otjAtRisk) return 50;
  return 0;
}
