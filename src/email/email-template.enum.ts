/** Nunjucks basename under `templates/emails/` (e.g. `password-reset.html.njk`). */
export enum EmailTemplate {
  COMMITMENT_READY_TO_SIGN = 'commitment-ready-to-sign',
  COMMITMENT_CHASE = 'commitment-chase',
  OTJ_WEEKLY_DIGEST = 'otj-weekly-digest',
  OTJ_DECISION = 'otj-decision',
  OTJ_PACE_ALERT = 'otj-pace-alert',
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
  INVITATION_ACCEPT = 'invitation-accept',
  REVIEW_REMINDER = 'review-reminder',
  MESSAGE_RECEIVED = 'message-received',
  LEVY_EXPIRY_90 = 'levy-expiry-90',
  LEVY_EXPIRY_30 = 'levy-expiry-30',
  FLOWPORTAL_REGISTRATION_COMPLETE = 'flowportal-registration-complete',
}
