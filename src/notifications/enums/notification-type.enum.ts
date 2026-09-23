/** Category of in-app / outbound notification. */
export enum NotificationType {
  SYSTEM = 'system',
  GENERIC = 'generic',
  INVITATION = 'invitation',
  OTJ = 'otj',
  REVIEW = 'review',
  COMMITMENT = 'commitment',
  PORTFOLIO = 'portfolio',
  ILR_SUBMISSION_SUCCEEDED = 'ilr_submission_succeeded',
  ILR_SUBMISSION_FAILED = 'ilr_submission_failed',
  LEVY_EXPIRY_90 = 'levy_expiry_90',
  LEVY_EXPIRY_30 = 'levy_expiry_30',
  MESSAGE = 'message',
  /** F2.2.5 AC3 — a tutor is over the at-risk caseload threshold. */
  CASELOAD_AT_RISK = 'caseload_at_risk',
  /** F3.4.3 AC2 — the apprentice's confirmed EPA date was set or changed. */
  EPA_DATE_UPDATED = 'epa_date_updated',
  /**
   * F3.4.3 AC2 — a milestone on the apprentice's journey was completed.
   *
   * Journey milestones are computed on read, so there is no transition to
   * emit from. `MilestoneNotificationsService` recomputes the journey on a
   * schedule and compares it against a marker per enrolment per milestone,
   * which is also what keeps this to one notification per milestone.
   */
  MILESTONE_COMPLETED = 'milestone_completed',
}
