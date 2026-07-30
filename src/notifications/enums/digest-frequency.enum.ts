/**
 * F1.2.3 AC7 — "Manager can configure digest frequency: daily / weekly / off".
 *
 * Kept separate from the existing `enabled` flag on NotificationPreference.
 * `enabled` answers "does this channel deliver at all"; frequency answers "how
 * often". Collapsing OFF into `enabled = false` would have worked, but then
 * "off" and "never configured" become indistinguishable, and a manager who
 * turns the digest off would silently have it switched back on by
 * `ensureDefaults`.
 */
export enum DigestFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  OFF = 'off',
}

/** The spec's default: a weekly digest every Monday. */
export const DEFAULT_DIGEST_FREQUENCY = DigestFrequency.WEEKLY;
