export enum PdfJobTemplate {
  HELLO = 'hello',
  REVIEW_SNAPSHOT = 'review_snapshot',
  COMMITMENT_SNAPSHOT = 'commitment_snapshot',
  LEVY_TRANSFER_AGREEMENT = 'levy_transfer_agreement',
  LEVY_ROI_REPORT = 'levy_roi_report',
  /** F1.3.3 AC3 — the audit trail for one commitment statement, as evidence. */
  COMMITMENT_AUDIT_TRAIL = 'commitment_audit_trail',
  /** F1.4.2 AC3 — the provider performance comparison as a standalone PDF. */
  PROVIDER_COMPARISON = 'provider_comparison',
}
