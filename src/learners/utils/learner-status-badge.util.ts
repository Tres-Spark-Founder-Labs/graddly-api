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
}

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
  return LearnerStatusBadge.ON_TRACK;
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
