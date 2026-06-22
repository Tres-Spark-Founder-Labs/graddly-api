import { ApprenticeStatus } from '../../apprentices/enums/apprentice-status.enum.js';
import { EnrolmentStatus } from '../../enrolments/enums/enrolment-status.enum.js';
import { OtjPaceAlertLevel } from '../../otj/enums/otj-pace-alert-level.enum.js';
import { ReviewStatus } from '../../reviews/enums/review-status.enum.js';

import {
  LearnerStatusBadge,
  computeInterventionSeverity,
  deriveLearnerStatusBadge,
  isGatewayStalled,
  isReviewOverdueByPrd,
} from './learner-status-badge.util.js';

describe('learner-status-badge.util', () => {
  describe('isReviewOverdueByPrd', () => {
    it('flags scheduled reviews more than 3 days past scheduledAt', () => {
      const scheduledAt = new Date('2026-01-01T10:00:00.000Z');
      const now = new Date('2026-01-05T10:00:00.000Z');
      expect(
        isReviewOverdueByPrd(scheduledAt, ReviewStatus.SCHEDULED, now),
      ).toBe(true);
    });

    it('does not flag within 3-day grace', () => {
      const scheduledAt = new Date('2026-01-03T10:00:00.000Z');
      const now = new Date('2026-01-05T09:00:00.000Z');
      expect(
        isReviewOverdueByPrd(scheduledAt, ReviewStatus.SCHEDULED, now),
      ).toBe(false);
    });
  });

  describe('deriveLearnerStatusBadge', () => {
    it('prioritises withdrawn over at-risk OTJ', () => {
      expect(
        deriveLearnerStatusBadge({
          apprenticeStatus: ApprenticeStatus.WITHDRAWN,
          enrolmentStatus: EnrolmentStatus.ACTIVE,
          otjPaceAlertLevel: OtjPaceAlertLevel.OFF_TRACK,
          gatewayCompletionPercent: 0,
          hasOverdueReview: true,
        }),
      ).toBe(LearnerStatusBadge.WITHDRAWN);
    });

    it('returns epa_ready when gateway complete', () => {
      expect(
        deriveLearnerStatusBadge({
          apprenticeStatus: ApprenticeStatus.ACTIVE,
          enrolmentStatus: EnrolmentStatus.ACTIVE,
          otjPaceAlertLevel: null,
          gatewayCompletionPercent: 100,
          hasOverdueReview: false,
        }),
      ).toBe(LearnerStatusBadge.EPA_READY);
    });
  });

  describe('isGatewayStalled', () => {
    it('is true when EPA within 90 days and checklist incomplete', () => {
      const now = new Date('2026-06-01T00:00:00.000Z');
      expect(isGatewayStalled('2026-08-01', 50, now)).toBe(true);
    });
  });

  describe('computeInterventionSeverity', () => {
    it('ranks off_track above review overdue', () => {
      expect(
        computeInterventionSeverity({
          otjOffTrack: true,
          reviewOverdue: true,
          gatewayStalled: true,
          otjAtRisk: true,
        }),
      ).toBe(100);
    });
  });
});
