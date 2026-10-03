export enum DasDonorLinkStatus {
  PENDING_CONSENT = 'pending_consent',
  LINKED = 'linked',
  ERROR = 'error',

  /**
   * TEMPORARY MODE FLAG. The link was recorded by hand rather than established
   * through the DAS OAuth consent flow, because the deployment has no ESFA
   * credentials. Distinct from LINKED so nothing treats it as a live
   * connection it can sync against.
   */
  MANUAL = 'manual',
}

/**
 * The statuses whose levy figures are real enough to read, report and alert on.
 *
 * ── WHY MANUAL BELONGS HERE ─────────────────────────────────────────────────
 *
 * D-05 accepted a guarded manual-entry path because no deployment has ESFA
 * credentials, so `manual` is not an edge case — it is the only mode anyone
 * actually runs in. Reading only `LINKED` meant a hand-entered expiry schedule
 * was stored correctly and then skipped by every feature that exists to act on
 * it: the expiry calendar returned `[]`, the surplus read zero, and the expiry
 * alert — the one that stops an employer silently losing money at the 24-month
 * mark — never fired for anybody.
 *
 * What `manual` still cannot do is talk to the ESFA, because there is no token
 * behind it. So this list governs **reads**: calendars, surplus, alerts. Calls
 * that cross the wire to DAS check for `LINKED` specifically and say plainly
 * why a manual account cannot make the trip.
 */
export const DONOR_LINK_READABLE_STATUSES: readonly DasDonorLinkStatus[] = [
  DasDonorLinkStatus.LINKED,
  DasDonorLinkStatus.MANUAL,
];
