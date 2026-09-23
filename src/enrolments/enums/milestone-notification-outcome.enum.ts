/**
 * What a row in `enrolment_milestone_notifications` records.
 *
 * There is no `claimed` value on purpose. A marker written before delivery
 * suppresses every later attempt, so a send that failed became permanent
 * silence — the fault six emitters were carrying before 6660672. The row is
 * written only once a channel has landed.
 */
export enum MilestoneNotificationOutcome {
  /** Accounted for without sending; `reason` says why. */
  SEEDED = 'seeded',
  /** Sent once, at `notifiedAt`. */
  NOTIFIED = 'notified',
}
