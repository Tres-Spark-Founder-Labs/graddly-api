import { NotificationChannel } from './enums/notification-channel.enum.js';
import { NotificationType } from './enums/notification-type.enum.js';

/**
 * What the platform does with each notification type, served to every portal
 * so none of them keeps its own list of types or labels.
 *
 * ── WHY `emailed` IS HERE ───────────────────────────────────────────────────
 *
 * A preference toggle is only a feature if switching it changes what is
 * sent. `emailed` is true exactly for the types some code path emails through
 * `NotificationsService.sendEmail` / `isEmailEnabled` — the send-time check —
 * and only those types offer an email switch. Offering one for a type that is
 * never emailed would be a setting with nothing behind it; offering none for
 * a type that is emailed would leave the recipient no way to stop it.
 *
 * `sendEmail` logs an error when asked to email a type marked `emailed:
 * false`, so a new email path cannot quietly outrun this table.
 *
 * ── WHAT IS DELIBERATELY NOT CONFIGURABLE ───────────────────────────────────
 *
 *   in_app   never. F3.4.3 AC1: the notification centre lists all
 *            notifications. Suppressing the in-app row would empty the centre,
 *            not quieten the inbox.
 *   digest   not through the per-type endpoint. The OTJ digest has a cadence
 *            (daily / weekly / off) and keeps its own endpoint,
 *            /notifications/preferences/digest; a second, frequency-blind
 *            switch for the same row would let the two disagree.
 *   invitation, system, generic
 *            transactional or operational. An invitation email is how a
 *            person joins; it is not a preference.
 */
export interface INotificationTypeEntry {
  /** What a person sees next to the switch. */
  label: string;
  /** True when some code path emails this type through the send-time check. */
  emailed: boolean;
}

export const NOTIFICATION_TYPE_CATALOGUE: Readonly<
  Record<NotificationType, INotificationTypeEntry>
> = Object.freeze({
  [NotificationType.OTJ]: {
    label: 'Off-the-job hours: approvals and pace alerts',
    emailed: true,
  },
  [NotificationType.REVIEW]: { label: 'Review reminders', emailed: true },
  [NotificationType.MESSAGE]: { label: 'New messages', emailed: true },
  [NotificationType.COMMITMENT]: {
    label: 'Commitment statements needing your signature',
    emailed: true,
  },
  [NotificationType.EPA_DATE_UPDATED]: {
    label: 'End-point assessment date changes',
    emailed: true,
  },
  [NotificationType.MILESTONE_COMPLETED]: {
    // Declared for F3.4.3 AC2; nothing emits it yet, so there is nothing to
    // switch off. See the note on the enum value.
    label: 'Milestones completed',
    emailed: false,
  },
  [NotificationType.LEVY_EXPIRY_90]: {
    label: 'Levy expiring in 90 days',
    emailed: true,
  },
  [NotificationType.LEVY_EXPIRY_30]: {
    label: 'Levy expiring in 30 days',
    emailed: true,
  },
  [NotificationType.PORTFOLIO]: { label: 'Portfolio updates', emailed: false },
  [NotificationType.ILR_SUBMISSION_SUCCEEDED]: {
    label: 'ILR submissions accepted',
    emailed: false,
  },
  [NotificationType.ILR_SUBMISSION_FAILED]: {
    label: 'ILR submissions failed',
    emailed: false,
  },
  [NotificationType.CASELOAD_AT_RISK]: {
    label: 'Tutor caseload over the at-risk threshold',
    emailed: false,
  },
  [NotificationType.INVITATION]: { label: 'Invitations', emailed: false },
  [NotificationType.SYSTEM]: { label: 'System notices', emailed: false },
  [NotificationType.GENERIC]: { label: 'General updates', emailed: false },
});

/** The channels a preference can exist for, in the order the API returns them. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] =
  Object.freeze([
    NotificationChannel.IN_APP,
    NotificationChannel.EMAIL,
    NotificationChannel.DIGEST,
  ]);

/**
 * Whether PATCH /notifications/preferences may set this pair. Only email, and
 * only for a type the platform emails; see the notes above for the rest.
 */
export function isConfigurablePreference(
  channel: NotificationChannel,
  type: NotificationType,
): boolean {
  return (
    channel === NotificationChannel.EMAIL &&
    NOTIFICATION_TYPE_CATALOGUE[type].emailed
  );
}
