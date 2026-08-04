/**
 * F2.3.1 AC7 — the DAS operations we make HTTP calls for.
 *
 * Named by intent rather than by path. `app.das.*Path` values are environment
 * configuration and differ between the ESFA sandbox and production; an
 * activity log keyed on the URL would stop grouping correctly the first time a
 * path changed, and "how many completion notifications failed last week" has
 * to survive that.
 */
export enum DasApiOperation {
  OAUTH_TOKEN = 'oauth_token',
  LEVY_BALANCE = 'levy_balance',
  FUNDING_PAYMENTS = 'funding_payments',
  ENROLMENT_SUBMIT = 'enrolment_submit',
  COMPLETION_NOTIFY = 'completion_notify',
  TRANSFER_CONSENT = 'transfer_consent',
  TRANSFER_STATUS = 'transfer_status',
}

/**
 * The operations that constitute a sync cycle, for AC5's "last sync time".
 *
 * A levy-balance read and a funding-payments pull are the platform keeping
 * itself current with the ESFA. A transfer-consent POST is a user action that
 * happens to use the same API. Both belong in the activity log; only the first
 * kind answers "when did we last sync".
 */
export const DAS_SYNC_OPERATIONS: readonly DasApiOperation[] = [
  DasApiOperation.LEVY_BALANCE,
  DasApiOperation.FUNDING_PAYMENTS,
] as const;
