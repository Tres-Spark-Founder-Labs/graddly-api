export enum DasSyncStatus {
  IDLE = 'idle',
  SUCCESS = 'success',
  FAILED = 'failed',

  /**
   * TEMPORARY MODE FLAG, not a sync outcome.
   *
   * Set when a figure was typed in by an administrator through /das/manual/*
   * because the deployment has no ESFA credentials. It sits in this enum
   * because the sync-status card reads one field, and a manual figure has to
   * be distinguishable from a synced one at that field or the card lies.
   *
   * Expected to disappear once DAS access is arranged: at that point every
   * row carrying it should be re-synced, and the value can be dropped.
   */
  MANUAL = 'manual',
}
