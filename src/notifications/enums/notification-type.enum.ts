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
}
