/** Nunjucks basename under `templates/emails/` (e.g. `password-reset.html.njk`). */
export enum EmailTemplate {
  PASSWORD_RESET = 'password-reset',
  EMAIL_VERIFICATION = 'email-verification',
  INVITATION_ACCEPT = 'invitation-accept',
  REVIEW_REMINDER = 'review-reminder',
  MESSAGE_RECEIVED = 'message-received',
  LEVY_EXPIRY_90 = 'levy-expiry-90',
  LEVY_EXPIRY_30 = 'levy-expiry-30',
}
