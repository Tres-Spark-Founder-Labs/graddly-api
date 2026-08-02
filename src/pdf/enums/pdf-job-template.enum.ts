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
  /** F2.1.2 AC5 — the Quality Improvement Plan as an inspection document. */
  QIP_PLAN = 'qip_plan',
  /** F2.2.1 AC5 — the full learner cohort table as a PDF. */
  LEARNER_COHORT = 'learner_cohort',
}
