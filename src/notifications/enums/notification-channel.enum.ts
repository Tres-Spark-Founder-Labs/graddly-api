/** Delivery channel for notification preferences. */
export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  DIGEST = 'digest',
  /** F3.4.3 AC4 — web push to a browser the user opted in on. */
  PUSH = 'push',
}
