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
